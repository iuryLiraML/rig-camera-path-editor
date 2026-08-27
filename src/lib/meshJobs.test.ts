import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setServerKeysForTests } from './agent/serverKeys'
import { configureFal, resetFalForTests, setFalTransportForTests } from './fal/client'
import { syncFalSettings } from './fal/settings'
import { setHistoryClockForTests } from './history'
import {
  cancelMeshJob,
  generateObjectFromText,
  remeshProgressFromQueueUpdate,
  remeshSceneObject,
  resetMeshJobsForTests,
} from './meshJobs'
import {
  FAL_REMESH_MAX_BYTES,
  clearMeshRevisionsForTests,
  clearParkedMeshesForTests,
  isRemeshPlaceholder,
  undoLastMeshRevision,
} from './sceneIO'
import { makeObject, objectGraveyard, useSceneStore } from '../state/useSceneStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'

const { idbMemory } = vi.hoisted(() => ({
  idbMemory: new Map<string, ArrayBuffer>(),
}))

vi.mock('./idb', () => ({
  STORES: { buffers: 'model-buffers', projects: 'projects', folders: 'folders' },
  idbPut: vi.fn(async (_store: string, value: unknown, key?: string) => {
    if (typeof key === 'string') idbMemory.set(key, value as ArrayBuffer)
  }),
  idbGet: vi.fn(async (_store: string, key: string) => idbMemory.get(key)),
  idbDelete: vi.fn(async (_store: string, key: string) => {
    idbMemory.delete(key)
  }),
  idbKeys: vi.fn(async () => [...idbMemory.keys()]),
  idbGetAll: vi.fn(async () => [...idbMemory.values()]),
}))

afterEach(() => {
  resetMeshJobsForTests()
  resetFalForTests()
  syncFalSettings('', '3.1')
  setServerKeysForTests(null)
  clearParkedMeshesForTests()
  clearMeshRevisionsForTests()
  setHistoryClockForTests(0)
  idbMemory.clear()
  objectGraveyard.clear()
  useSceneStore.setState({ objects: [], pendingLifts: [], notice: null })
  useEnvironmentStore.setState({ unplacedAssets: [] })
})

function encodeTriangleGlb(triangles: 1 | 2): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0])
  const indices = triangles === 1 ? new Uint16Array([0, 1, 2]) : new Uint16Array([0, 1, 2, 1, 3, 2])
  const posBytes = new Uint8Array(positions.buffer)
  const indexBytes = new Uint8Array(indices.buffer)
  const indexPad = (4 - (indexBytes.byteLength % 4)) % 4
  const bin = new Uint8Array(posBytes.byteLength + indexBytes.byteLength + indexPad)
  bin.set(posBytes, 0)
  bin.set(indexBytes, posBytes.byteLength)
  const doc = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        max: [1, 1, 0],
        min: [0, 0, 0],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: triangles === 1 ? 3 : 6,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: posBytes.byteLength, byteLength: indexBytes.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: bin.byteLength }],
  }
  const json = new TextEncoder().encode(JSON.stringify(doc))
  const jsonPad = (4 - (json.length % 4)) % 4
  const jsonChunk = json.length + jsonPad
  const binPad = (4 - (bin.byteLength % 4)) % 4
  const binChunk = bin.byteLength + binPad
  const bytes = new Uint8Array(12 + 8 + jsonChunk + 8 + binChunk)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.byteLength, true)
  view.setUint32(12, jsonChunk, true)
  view.setUint32(16, 0x4e4f534a, true)
  bytes.set(json, 20)
  for (let i = 0; i < jsonPad; i++) bytes[20 + json.length + i] = 0x20
  const binHeader = 20 + jsonChunk
  view.setUint32(binHeader, binChunk, true)
  view.setUint32(binHeader + 4, 0x004e4942, true)
  bytes.set(bin, binHeader + 8)
  return bytes.buffer
}

function boxObject(id: string, name: string) {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
  return makeObject(name, root, { id, bufferKey: id })
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
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

  it('parks the live mesh and restores it when remesh is cancelled', async () => {
    const live = boxObject('car-1', 'Car')
    useSceneStore.setState({ objects: [live], pendingLifts: [], notice: null })
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

    const pending = remeshSceneObject('car-1', { sourceBuffer: new ArrayBuffer(8) })
    await entered
    expect(isRemeshPlaceholder(useSceneStore.getState().objects[0].root)).toBe(true)
    const lift = useSceneStore.getState().pendingLifts.find((item) => item.kind === 'remesh')
    cancelMeshJob(lift!.id)
    await pending
    const restored = useSceneStore.getState().objects[0]
    expect(restored.id).toBe('car-1')
    expect(isRemeshPlaceholder(restored.root)).toBe(false)
    expect(useSceneStore.getState().notice).toBe('Remesh cancelled.')
  })

  it('restores the parked mesh onto a deleted object so undo can resurrect it', async () => {
    const live = boxObject('car-1', 'Car')
    const original = live.root
    useSceneStore.setState({ objects: [live], pendingLifts: [], notice: null })
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

    const pending = remeshSceneObject('car-1', { sourceBuffer: new ArrayBuffer(8) })
    await entered
    expect(isRemeshPlaceholder(useSceneStore.getState().objects[0].root)).toBe(true)
    useSceneStore.getState().removeObject('car-1')
    await pending
    expect(useSceneStore.getState().objects).toEqual([])
    const buried = objectGraveyard.get('car-1')
    expect(buried?.root).toBe(original)
    expect(isRemeshPlaceholder(buried!.root)).toBe(false)
  })

  it('does not steal a duplicate’s shared buffer when remesh is cancelled', async () => {
    const live = boxObject('car-1', 'Car')
    const copy = boxObject('car-copy', 'Car copy')
    copy.bufferKey = 'car-1'
    useSceneStore.setState({ objects: [live, copy], pendingLifts: [], notice: null })
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

    const pending = remeshSceneObject('car-1', { sourceBuffer: new ArrayBuffer(8) })
    await entered
    expect(useSceneStore.getState().objects.find((item) => item.id === 'car-1')?.bufferKey).not.toBe(
      'car-1',
    )
    expect(useSceneStore.getState().objects.find((item) => item.id === 'car-copy')?.bufferKey).toBe(
      'car-1',
    )
    const lift = useSceneStore.getState().pendingLifts.find((item) => item.kind === 'remesh')
    cancelMeshJob(lift!.id)
    await pending
    expect(useSceneStore.getState().objects.find((item) => item.id === 'car-1')?.bufferKey).toBe(
      'car-1',
    )
    expect(useSceneStore.getState().objects.find((item) => item.id === 'car-copy')?.bufferKey).toBe(
      'car-1',
    )
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

  it('records undo after remesh of a shared-key duplicate', async () => {
    const original = encodeTriangleGlb(1)
    const remeshed = encodeTriangleGlb(2)
    idbMemory.set('car-1', original)
    const live = boxObject('car-1', 'Car')
    const copy = boxObject('car-copy', 'Car copy')
    copy.bufferKey = 'car-1'
    useSceneStore.setState({ objects: [live, copy], pendingLifts: [], notice: null })
    configureFal('key-test')
    syncFalSettings('key-test', '3.1')
    setFalTransportForTests({
      upload: async () => 'https://up',
      subscribe: async () => ({ model_mesh: { url: 'https://out.glb' } }),
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      ({
        ok: true,
        arrayBuffer: async () => remeshed.slice(0),
      }) as Response) as typeof fetch
    try {
      await remeshSceneObject('car-1')
      const remeshedObject = useSceneStore.getState().objects.find((item) => item.id === 'car-1')
      const sibling = useSceneStore.getState().objects.find((item) => item.id === 'car-copy')
      expect(remeshedObject?.bufferKey).toBeTruthy()
      expect(remeshedObject?.bufferKey).not.toBe('car-1')
      expect(sibling?.bufferKey).toBe('car-1')
      expect(isRemeshPlaceholder(remeshedObject!.root)).toBe(false)
      expect(remeshedObject?.triangleCount).toBe(2)
      expect(idbMemory.get(remeshedObject!.bufferKey!)?.byteLength).toBe(remeshed.byteLength)
      expect(undoLastMeshRevision('car-1')).toBe(true)
      let restored = useSceneStore.getState().objects.find((item) => item.id === 'car-1')
      for (let i = 0; i < 20 && restored?.triangleCount !== 1; i++) {
        await flush()
        restored = useSceneStore.getState().objects.find((item) => item.id === 'car-1')
      }
      expect(restored?.bufferKey).not.toBe('car-1')
      expect(restored?.triangleCount).toBe(1)
      expect(useSceneStore.getState().objects.find((item) => item.id === 'car-copy')?.bufferKey).toBe(
        'car-1',
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('generateObjectFromText', () => {
  it('parks the GLB on Unplaced instead of dropping it in the scene', async () => {
    configureFal('key-test')
    syncFalSettings('key-test', '3.1')
    setFalTransportForTests({
      subscribe: async () => ({ model_mesh: { url: 'https://out.glb' } }),
      upload: async () => 'https://up',
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === 'https://out.glb') {
        return new Response(new Uint8Array(encodeTriangleGlb(1)), { status: 200 })
      }
      throw new Error(`unexpected fetch ${String(input)}`)
    }) as typeof fetch
    try {
      await generateObjectFromText('helmet')
      expect(useSceneStore.getState().objects).toHaveLength(0)
      const shelf = useEnvironmentStore.getState().unplacedAssets
      expect(shelf).toHaveLength(1)
      expect(shelf[0]?.name).toBe('helmet')
      expect(shelf[0]?.rigKind).toBe('none')
      expect(useSceneStore.getState().notice).toContain('Unplaced')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
