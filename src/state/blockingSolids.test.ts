import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { makePrimitive, useSceneStore } from './useSceneStore'
import { useRigStore } from './useRigStore'
import { loadSceneFromMetas, liveSceneMetas, resetScene } from '../lib/sceneIO'
import { booleanPrimitive, primitiveMesh } from '../lib/solidEditing'
import { buildPrimitiveGeometry, defaultParams, PRIMITIVE_KINDS, primitiveEvaluationCount, primitiveTopology, buildPrimitiveSeedGeometry, type PrimitiveSpec } from '../lib/primitiveGeometry'
import { evalObjectWorldTransform } from '../lib/objectMotion'

const scene = () => useSceneStore.getState()
const boxSpec = (width = 4): PrimitiveSpec => ({ kind: 'box', params: { width, height: 4, depth: 2, corner: 0 } })
function add(spec: PrimitiveSpec) {
  const object = makePrimitive(spec.kind, { primitive: spec })
  scene().addObject(object)
  return object.id
}
const object = (id: string) => scene().objects.find((o) => o.id === id)!
const volume = (id: string) => primitiveMesh(object(id)).geometry.userData.cadVolume as number
function holeHits(id: string) {
  const mesh = primitiveMesh(object(id))
  mesh.updateMatrixWorld(true)
  return new THREE.Raycaster(new THREE.Vector3(0, 2, 10), new THREE.Vector3(0, 0, -1)).intersectObject(mesh).length
}
function cutWall() {
  const wall = add(boxSpec())
  const cutter = add({ kind: 'box', params: { width: 1, height: 1, depth: 4, corner: 0 } })
  scene().setTransform(cutter, 'position', 1, 1.5)
  booleanPrimitive(wall, cutter, 'subtract')
  return { wall, cutter }
}

beforeEach(() => { useSceneStore.setState({ objects: [] }); useRigStore.setState({ t: 0 }) })

describe('blocking solids through scene editing and persistence', () => {
  it('rebuilds old zero-op specs with the existing seed bounds', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const spec = { kind, params: defaultParams(kind) }
      const before = buildPrimitiveSeedGeometry(spec)
      before.computeBoundingBox()
      const id = add(spec)
      const after = primitiveMesh(object(id)).geometry
      expect(after.boundingBox!.min.distanceTo(before.boundingBox!.min)).toBeLessThan(1e-5)
      expect(after.boundingBox!.max.distanceTo(before.boundingBox!.max)).toBeLessThan(1e-5)
      expect(volume(id)).toBeGreaterThan(0)
      before.dispose()
    }
  })

  it('preserves a through-hole and editable operations after JSON reload', async () => {
    const { wall, cutter } = cutWall()
    expect(volume(wall)).toBeCloseTo(30, 4)
    expect(holeHits(wall)).toBe(0)
    scene().removeObject(cutter)
    await loadSceneFromMetas(JSON.parse(JSON.stringify(liveSceneMetas())))
    expect(volume(wall)).toBeCloseTo(30, 4)
    expect(holeHits(wall)).toBe(0)
    expect(object(wall).primitive!.ops).toHaveLength(1)
    scene().updatePrimitiveParams(wall, { width: 6 })
    expect(volume(wall)).toBeCloseTo(46, 4)
    expect(holeHits(wall)).toBe(0)
  })

  it('does not re-evaluate solids when scrubbing t and evaluating animated TRS', () => {
    const { wall } = cutWall()
    const mesh = primitiveMesh(object(wall))
    const geometry = mesh.geometry
    const count = primitiveEvaluationCount()
    for (const t of [0, 0.5, 1, 0.25, 0]) {
      useRigStore.getState().setT(t)
      evalObjectWorldTransform(t, object(wall), null, useRigStore.getState().ease)
      expect(primitiveMesh(object(wall)).geometry).toBe(geometry)
    }
    expect(primitiveEvaluationCount()).toBe(count)
  })

  it('extrudes a planar face, then replays it after a seed width edit', () => {
    const id = add(boxSpec())
    const face = primitiveTopology(primitiveMesh(object(id)).geometry).faces.find((f) => f.normal[1] > 0.99)!
    scene().appendPrimitiveOp(id, { type: 'extrude', face: face.ref, distance: 1 })
    expect(volume(id)).toBeCloseTo(40, 4)
    scene().updatePrimitiveParams(id, { width: 6 })
    expect(volume(id)).toBeCloseTo(60, 4)
    scene().appendPrimitiveOp(id, { type: 'slice', normal: [0, 1, 0], offset: 0, keep: 'positive' })
    expect(volume(id)).toBeCloseTo(36, 4)
    expect(primitiveMesh(object(id)).position.y).toBe(2)
  })

  it('supports union and intersection with transformed operands', () => {
    const a = add({ kind: 'box', params: { width: 2, height: 2, depth: 2, corner: 0 } })
    const b = add({ kind: 'box', params: { width: 2, height: 2, depth: 2, corner: 0 } })
    scene().setTransform(b, 'position', 0, 1)
    booleanPrimitive(a, b, 'union')
    expect(volume(a)).toBeCloseTo(12, 4)
    scene().removeLastPrimitiveOp(a)
    booleanPrimitive(a, b, 'intersect')
    expect(volume(a)).toBeCloseTo(4, 4)
  })

  it('rejects an empty cut atomically and preserves the last valid mesh', () => {
    const id = add(boxSpec())
    const before = primitiveMesh(object(id)).geometry
    expect(() => scene().appendPrimitiveOp(id, { type: 'slice', normal: [1, 0, 0], offset: 100, keep: 'positive' })).toThrow()
    expect(primitiveMesh(object(id)).geometry).toBe(before)
    expect(object(id).primitive!.ops).toBeUndefined()
  })

  it('duplicates operations independently and restores a prior spec', () => {
    const { wall } = cutWall()
    const saved = structuredClone(object(wall).primitive!)
    scene().duplicateObject(wall)
    const copy = scene().objects.at(-1)!
    expect(copy.primitive).toEqual(saved)
    scene().updatePrimitiveParams(copy.id, { width: 5 })
    expect(volume(copy.id)).toBeCloseTo(38, 4)
    expect(volume(wall)).toBeCloseTo(30, 4)
    const restored = buildPrimitiveGeometry(saved)
    expect(restored.userData.cadVolume).toBeCloseTo(30, 4)
    restored.dispose()
  })

  it('leaves new and empty restored scenes free of seeded knots', async () => {
    await loadSceneFromMetas([])
    expect(scene().objects).toHaveLength(0)
    await resetScene()
    expect(scene().objects).toHaveLength(0)
  })
})
