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

  it('prefers a scene object over a path line at the same depth', () => {
    const tagged = tagHits([
      hit('path-line', 'path:a', 1),
      hit('object', 'obj:box', 1.02),
      hit('path-anchor', 'anchor:1', 1.01),
    ])
    const ordered = preferTaggedHits(tagged)
    expect(ordered[0]?.id).toBe('obj:box')
    expect(ordered[0]?.kind).toBe('object')
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

  it('does not treat a lone spline hit as an orbit lock', () => {
    expect(hasInteractivePick([hit('path-line', 'path:a', 1)])).toBe(false)
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
})
