import * as THREE from 'three'
import { describe, expect, it, beforeEach } from 'vitest'
import {
  beginPickClick,
  filterViewportHits,
  hasInteractivePick,
  pickKindOf,
  preferTaggedHits,
  resetPickCycle,
  setPickPointer,
  tagHits,
} from './viewportPick'

function hit(kind: string, id: string, distance: number) {
  const object = new THREE.Object3D()
  object.userData.pickKind = kind
  object.userData.pickId = id
  return { object, distance }
}

describe('viewportPick', () => {
  beforeEach(() => resetPickCycle())

  it('reads pickKind from an ancestor, including TransformControls', () => {
    const root = new THREE.Object3D()
    root.name = 'TransformControlsGizmo'
    const child = new THREE.Mesh()
    root.add(child)
    expect(pickKindOf(child)).toBe('gizmo')
  })

  it('drops the transform plane so a mesh click next to the gizmo stays a mesh', () => {
    const plane = new THREE.Object3D()
    plane.name = 'TransformControlsPlane'
    expect(pickKindOf(plane)).toBeNull()

    const tagged = tagHits([
      { object: plane, distance: 1 },
      hit('object', 'obj:box', 1.01),
      hit('camera', 'cinema-camera', 2.5),
    ])
    const ordered = preferTaggedHits(tagged)
    expect(ordered[0]?.id).toBe('obj:box')
    expect(ordered[0]?.kind).toBe('object')
  })

  it('keeps the W/E/R arrows even when a mesh or camera sits closer on the ray', () => {
    const root = new THREE.Object3D()
    root.name = 'TransformControlsGizmo'
    const child = new THREE.Mesh()
    root.add(child)
    const tagged = tagHits([
      { object: child, distance: 1.4 },
      hit('object', 'obj:box', 1),
      hit('camera', 'cinema-camera', 1.1),
    ])
    expect(preferTaggedHits(tagged)[0]?.kind).toBe('gizmo')
  })

  it('prefers a scene object over a fat path line at the same depth', () => {
    const tagged = tagHits([
      hit('path-line', 'path:a', 1),
      hit('object', 'obj:box', 1.02),
    ])
    const ordered = preferTaggedHits(tagged)
    expect(ordered[0]?.id).toBe('obj:box')
    expect(ordered[0]?.kind).toBe('object')
  })

  it('selects a cube in front of the camera icon, not the camera', () => {
    const tagged = tagHits([
      hit('object', 'obj:box', 1),
      hit('camera', 'cinema-camera', 1.12),
    ])
    const ordered = preferTaggedHits(tagged)
    expect(ordered[0]?.id).toBe('obj:box')
    expect(ordered[0]?.kind).toBe('object')
  })

  it('selects the camera when it is clearly closer than the mesh', () => {
    const tagged = tagHits([
      hit('camera', 'cinema-camera', 1),
      hit('object', 'obj:box', 2.2),
    ])
    expect(preferTaggedHits(tagged)[0]?.id).toBe('cinema-camera')
  })

  it('cycles stacked objects only on repeated clicks, not hover', () => {
    const stacked = [hit('object', 'obj:a', 1), hit('object', 'obj:b', 1.01)]

    setPickPointer(10, 10)
    expect(preferTaggedHits(tagHits(stacked))[0]?.id).toBe('obj:a')

    beginPickClick(10, 10)
    expect(preferTaggedHits(tagHits(stacked))[0]?.id).toBe('obj:a')

    setPickPointer(10, 12)
    expect(preferTaggedHits(tagHits(stacked))[0]?.id).toBe('obj:a')

    beginPickClick(11, 11)
    expect(preferTaggedHits(tagHits(stacked))[0]?.id).toBe('obj:b')

    beginPickClick(12, 10)
    expect(preferTaggedHits(tagHits(stacked))[0]?.id).toBe('obj:a')
  })

  it('does not treat a lone spline or pen-plane hit as an orbit lock', () => {
    expect(hasInteractivePick([hit('path-line', 'path:a', 1)])).toBe(false)
    expect(hasInteractivePick([hit('pen', 'pen-plane', 1)])).toBe(false)
    expect(hasInteractivePick([hit('object', 'obj:a', 1)])).toBe(true)
  })

  it('drops unmarked helpers from the R3F hit list', () => {
    const helper = new THREE.Object3D()
    const object = new THREE.Object3D()
    object.userData.pickKind = 'object'
    object.userData.pickId = 'obj:keep'
    const filtered = filterViewportHits([
      { object: helper, distance: 0.5 },
      { object, distance: 1 },
    ])
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.object).toBe(object)
  })

  it('keeps the pen drawing plane in the filtered hit list', () => {
    const filtered = filterViewportHits([hit('pen', 'pen-plane', 2)])
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.object.userData.pickId).toBe('pen-plane')
  })

  it('lets scene objects beat the pen plane when both are on the ray', () => {
    const tagged = tagHits([
      hit('pen', 'pen-plane', 1),
      hit('object', 'obj:box', 1.05),
    ])
    const ordered = preferTaggedHits(tagged)
    expect(ordered[0]?.id).toBe('obj:box')
    expect(ordered.map((item) => item.id)).toContain('pen-plane')
  })
})
