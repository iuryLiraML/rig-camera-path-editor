import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { makeObject, useSceneStore } from './useSceneStore'

afterEach(() => {
  useSceneStore.setState({ objects: [], pendingLifts: [] })
})

describe('replaceImportedRoot', () => {
  it('swaps the live root and reapplies clay', () => {
    const first = new THREE.Group()
    first.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    const object = makeObject('Import', first, { bufferKey: 'buf-1', id: 'obj-1' })
    useSceneStore.setState({ objects: [object] })

    const next = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8))
    next.add(mesh)
    const clip = new THREE.AnimationClip('idle', 1, [])
    useSceneStore.getState().replaceImportedRoot('obj-1', next, [clip])

    const live = useSceneStore.getState().objects[0]
    expect(live?.root).toBe(next)
    expect(live?.clips).toEqual([clip])
    expect(live?.primitive).toBeUndefined()
    expect(mesh.material).toBe(live?.material)
  })

  it('keeps the cached triangle count when swapping in a remesh placeholder', () => {
    const first = new THREE.Group()
    first.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    const object = makeObject('Car', first, {
      bufferKey: 'car',
      id: 'car',
      triangleCount: 90_000,
    })
    useSceneStore.setState({ objects: [object] })
    const cube = new THREE.Group()
    cube.userData.rigRemeshPlaceholder = true
    cube.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    useSceneStore.getState().replaceImportedRoot('car', cube, [])
    expect(useSceneStore.getState().objects[0]?.triangleCount).toBe(90_000)
  })

  it('copies the cached triangle count when duplicating an import', () => {
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    const object = makeObject('Car', root, {
      bufferKey: 'car',
      id: 'car',
      triangleCount: 90_000,
    })
    useSceneStore.setState({ objects: [object] })
    useSceneStore.getState().duplicateObject('car')
    const copy = useSceneStore.getState().objects.find((item) => item.id !== 'car')
    expect(copy?.triangleCount).toBe(90_000)
    expect(copy?.bufferKey).toBe('car')
  })
})

describe('pending generate jobs', () => {
  it('records generate jobs as ghost rows and remesh jobs on the object', () => {
    const generateId = useSceneStore.getState().beginLift('House — Generating…', 'generate')
    const remeshId = useSceneStore.getState().beginLift('Car — Remeshing…', 'remesh', 'car-1')
    const pending = useSceneStore.getState().pendingLifts
    expect(pending.map((lift) => lift.kind)).toEqual(['generate', 'remesh'])
    expect(pending[0]?.objectId).toBeUndefined()
    expect(pending[0]?.progress).toBeNull()
    expect(pending[1]?.objectId).toBe('car-1')
    expect(pending[1]?.progress).toBeNull()
    useSceneStore.getState().setLiftProgress(remeshId, 0.4)
    expect(useSceneStore.getState().pendingLifts[1]?.progress).toBe(0.4)
    useSceneStore.getState().endLift(generateId)
    useSceneStore.getState().endLift(remeshId)
    expect(useSceneStore.getState().pendingLifts).toEqual([])
  })
})
