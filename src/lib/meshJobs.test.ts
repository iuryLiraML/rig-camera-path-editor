import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { setServerKeysForTests } from './agent/serverKeys'
import { configureFal, resetFalForTests, setFalTransportForTests } from './fal/client'
import { syncFalSettings } from './fal/settings'
import {
  cancelMeshJob,
  remeshProgressFromQueueUpdate,
  remeshSceneObject,
  resetMeshJobsForTests,
} from './meshJobs'
import { FAL_REMESH_MAX_BYTES } from './sceneIO'
import { makeObject, useSceneStore } from '../state/useSceneStore'

afterEach(() => {
  resetMeshJobsForTests()
  resetFalForTests()
  syncFalSettings('', '3.1')
  setServerKeysForTests(null)
  useSceneStore.setState({ objects: [], pendingLifts: [], notice: null })
})

function boxObject(id: string, name: string) {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
  return makeObject(name, root, { id, bufferKey: id })
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

describe('remeshProgressFromQueueUpdate', () => {
  it('stays indeterminate without a real fraction', () => {
    expect(remeshProgressFromQueueUpdate({ status: 'IN_QUEUE', queue_position: 3 })).toBeNull()
    expect(remeshProgressFromQueueUpdate({ status: 'IN_PROGRESS', logs: [] })).toBeNull()
    expect(remeshProgressFromQueueUpdate({ status: 'IN_PROGRESS', logs: [{ message: 'working' }] })).toBeNull()
  })

  it('reads a percentage from Fal logs or a progress field', () => {
    expect(
      remeshProgressFromQueueUpdate({
        status: 'IN_PROGRESS',
        logs: [{ message: 'remesh 40%' }],
      }),
    ).toBe(0.4)
    expect(remeshProgressFromQueueUpdate({ status: 'IN_PROGRESS', progress: 0.7 })).toBe(0.7)
    expect(remeshProgressFromQueueUpdate({ status: 'IN_PROGRESS', percentage: 80 })).toBe(0.8)
  })
})

describe('remeshSceneObject', () => {
  it('does not call Fal when the file is over 150 MB', async () => {
    useSceneStore.setState({ objects: [boxObject('car-1', 'Car')], pendingLifts: [], notice: null })
    configureFal('key-test')
    syncFalSettings('key-test', '3.1')
    let called = false
    setFalTransportForTests({
      subscribe: async () => {
        called = true
        return { model_mesh: { url: 'https://out.glb' } }
      },
      upload: async () => 'https://up',
    })
    await remeshSceneObject('car-1', {
      sourceBuffer: new ArrayBuffer(FAL_REMESH_MAX_BYTES + 1),
      placeholder: true,
    })
    expect(called).toBe(false)
    expect(useSceneStore.getState().notice).toBe('"Car" is too large to remesh (max 150 MB).')
    expect(useSceneStore.getState().objects).toEqual([])
  })

  it('runs remesh jobs one at a time', async () => {
    useSceneStore.setState({
      objects: [boxObject('car-1', 'Car'), boxObject('van-1', 'Van')],
      pendingLifts: [],
      notice: null,
    })
    configureFal('key-test')
    syncFalSettings('key-test', '3.1')

    let active = 0
    let maxActive = 0
    let releaseFirst: (() => void) | undefined
    const firstHold = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const order: string[] = []

    setFalTransportForTests({
      upload: async (file) => `https://${file.name}`,
      subscribe: async (_model, input) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        order.push(String(input.mesh_url))
        if (order.length === 1) await firstHold
        active -= 1
        return { model_mesh: { url: 'https://out.glb' } }
      },
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('download skipped')
    }) as typeof fetch

    try {
      const a = remeshSceneObject('car-1', { sourceBuffer: new ArrayBuffer(8), placeholder: true })
      const b = remeshSceneObject('van-1', { sourceBuffer: new ArrayBuffer(8), placeholder: true })
      await flush()
      expect(order).toEqual(['https://Car.glb'])
      expect(maxActive).toBe(1)
      releaseFirst?.()
      await Promise.all([a, b])
      expect(order).toEqual(['https://Car.glb', 'https://Van.glb'])
      expect(maxActive).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('removes a placeholder when remesh is cancelled', async () => {
    useSceneStore.setState({ objects: [boxObject('car-1', 'Car')], pendingLifts: [], notice: null })
    configureFal('key-test')
    syncFalSettings('key-test', '3.1')
    let enteredSubscribe: (() => void) | undefined
    const entered = new Promise<void>((resolve) => {
      enteredSubscribe = resolve
    })
    setFalTransportForTests({
      upload: async () => 'https://up',
      subscribe: async (_model, _input, opts) => {
        enteredSubscribe?.()
        await new Promise<never>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The user aborted a request.', 'AbortError'))
          })
        })
      },
    })

    const pending = remeshSceneObject('car-1', {
      sourceBuffer: new ArrayBuffer(8),
      placeholder: true,
    })
    await entered
    const lift = useSceneStore.getState().pendingLifts.find((item) => item.kind === 'remesh')
    expect(lift?.objectId).toBe('car-1')
    expect(lift?.progress).toBeNull()
    cancelMeshJob(lift!.id)
    await pending
    expect(useSceneStore.getState().objects).toEqual([])
    expect(useSceneStore.getState().notice).toBe('Remesh cancelled.')
  })

  it('records real Fal progress on the lift', async () => {
    useSceneStore.setState({ objects: [boxObject('car-1', 'Car')], pendingLifts: [], notice: null })
    configureFal('key-test')
    syncFalSettings('key-test', '3.1')
    const seen: Array<number | null> = []
    setFalTransportForTests({
      upload: async () => 'https://up',
      subscribe: async (_model, _input, opts) => {
        opts?.onQueueUpdate?.({ status: 'IN_PROGRESS', logs: [{ message: '62%' }] })
        seen.push(useSceneStore.getState().pendingLifts[0]?.progress ?? null)
        return { model_mesh: { url: 'https://out.glb' } }
      },
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('download skipped')
    }) as typeof fetch
    try {
      await remeshSceneObject('car-1', { sourceBuffer: new ArrayBuffer(8), placeholder: true })
      expect(seen).toEqual([0.62])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
