import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyClay,
  clearObjectGraveyard,
  makeObject,
  objectGraveyard,
  restoreImportedMaterials,
  useSceneStore,
} from './useSceneStore'
import { loadSceneFromMetas, resetScene } from '../lib/sceneIO'

afterEach(() => {
  clearObjectGraveyard()
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
    expect(live?.remeshed).toBeUndefined()
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
    expect(useSceneStore.getState().objects[0]?.remeshed).toBeUndefined()
  })

  it('copies the cached triangle count when duplicating an import', () => {
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))
    const object = makeObject('Car', root, {
      bufferKey: 'car',
      id: 'car',
      modelFormat: 'obj',
      triangleCount: 90_000,
    })
    useSceneStore.setState({ objects: [object] })
    useSceneStore.getState().duplicateObject('car')
    const copy = useSceneStore.getState().objects.find((item) => item.id !== 'car')
    expect(copy?.triangleCount).toBe(90_000)
    expect(copy?.bufferKey).toBe('car')
    expect(copy?.modelFormat).toBe('obj')
  })
})

describe('keepTexture', () => {
  it('stashes imported maps instead of applying clay', () => {
    const root = new THREE.Group()
    const source = new THREE.MeshStandardMaterial({ color: 0xff0000 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), source)
    root.add(mesh)
    const object = makeObject('SAM', root, { keepTexture: true })
    expect(object.keepTexture).toBe(true)
    expect(mesh.material).toBe(source)
    expect(mesh.userData.rigSourceMaterial).toBe(source)
    applyClay(root, object.material)
    expect(mesh.material).toBe(object.material)
    restoreImportedMaterials(root)
    expect(mesh.material).toBe(source)
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
    expect(pending[1]?.startedAt).toBeGreaterThan(0)
    useSceneStore.getState().setLiftProgress(remeshId, 0.4)
    expect(useSceneStore.getState().pendingLifts[1]?.progress).toBe(0.4)
    useSceneStore.getState().endLift(generateId)
    useSceneStore.getState().endLift(remeshId)
    expect(useSceneStore.getState().pendingLifts).toEqual([])
  })
})

describe('scene object display resource lifecycle', () => {
  it('retains display materials for undo, then disposes them on scene reload', async () => {
    const live = makeObject('Live', new THREE.Group(), { id: 'live' })
    const retained = makeObject('Retained', new THREE.Group(), { id: 'retained' })
    const liveDispose = vi.spyOn(live.wireframeMaterial, 'dispose')
    const retainedDispose = vi.spyOn(retained.wireframeMaterial, 'dispose')
    useSceneStore.setState({ objects: [live, retained] })

    useSceneStore.getState().removeObject('retained')
    expect(retainedDispose).not.toHaveBeenCalled()
    expect(objectGraveyard.get('retained')).toBe(retained)

    await loadSceneFromMetas([], false)

    expect(liveDispose).toHaveBeenCalledOnce()
    expect(retainedDispose).toHaveBeenCalledOnce()
    expect(objectGraveyard.size).toBe(0)
  })

  it('disposes the oldest retained material only when the graveyard evicts it', () => {
    const objects = Array.from({ length: 41 }, (_, index) =>
      makeObject(`Object ${index}`, new THREE.Group(), { id: `object-${index}` }),
    )
    const oldestDispose = vi.spyOn(objects[0].wireframeMaterial, 'dispose')
    const newestDispose = vi.spyOn(objects[40].wireframeMaterial, 'dispose')
    useSceneStore.setState({ objects })

    for (const object of objects) useSceneStore.getState().removeObject(object.id)

    expect(oldestDispose).toHaveBeenCalledOnce()
    expect(newestDispose).not.toHaveBeenCalled()
    expect(objectGraveyard.size).toBe(40)
  })

  it('disposes live and retained display materials when the scene resets', async () => {
    const live = makeObject('Live', new THREE.Group(), { id: 'live' })
    const retained = makeObject('Retained', new THREE.Group(), { id: 'retained' })
    const liveDispose = vi.spyOn(live.wireframeMaterial, 'dispose')
    const retainedDispose = vi.spyOn(retained.wireframeMaterial, 'dispose')
    useSceneStore.setState({ objects: [live, retained] })
    useSceneStore.getState().removeObject('retained')

    await resetScene()

    expect(liveDispose).toHaveBeenCalledOnce()
    expect(retainedDispose).toHaveBeenCalledOnce()
  })
})
