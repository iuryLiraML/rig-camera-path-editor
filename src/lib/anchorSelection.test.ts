import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  centroidOf,
  clickAnchorSelection,
  primaryAnchorId,
  toggleAnchorSelection,
  transformAnchorsAroundPivot,
  translateAnchors,
} from './anchorSelection'
import { makeAnchor } from '../state/usePathStore'

describe('anchorSelection', () => {
  it('toggles an id in and out of the set', () => {
    expect(toggleAnchorSelection([], 'a')).toEqual(['a'])
    expect(toggleAnchorSelection(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggleAnchorSelection(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('keeps a multi-selection when clicking a member without Shift', () => {
    expect(clickAnchorSelection(['a', 'b'], 'a', false)).toEqual(['a', 'b'])
    expect(clickAnchorSelection(['a', 'b'], 'c', false)).toEqual(['c'])
  })

  it('uses Shift to add or remove without replacing', () => {
    expect(clickAnchorSelection(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(clickAnchorSelection(['a', 'b'], 'a', true)).toEqual(['b'])
  })

  it('treats the last id as the primary', () => {
    expect(primaryAnchorId(['a', 'b'])).toBe('b')
    expect(primaryAnchorId([])).toBeNull()
  })

  it('translates only the selected anchors by the same delta', () => {
    const a = makeAnchor([0, 1, 0])
    const b = makeAnchor([2, 1, 0])
    const c = makeAnchor([4, 1, 0])
    const next = translateAnchors([a, b, c], [a.id, c.id], [0.5, 0, -1])
    expect(next[0].position).toEqual([0.5, 1, -1])
    expect(next[1].position).toEqual([2, 1, 0])
    expect(next[2].position).toEqual([4.5, 1, -1])
  })

  it('puts the centroid at the average of the points', () => {
    expect(centroidOf([[0, 0, 0], [2, 4, 6]])).toEqual([1, 2, 3])
  })

  it('translates a group by moving the pivot with identity rotation', () => {
    const a = makeAnchor([0, 1, 0])
    const b = makeAnchor([2, 1, 0])
    const snapshot = [
      { id: a.id, position: a.position, handleIn: a.handleIn, handleOut: a.handleOut },
      { id: b.id, position: b.position, handleIn: b.handleIn, handleOut: b.handleOut },
    ]
    const next = transformAnchorsAroundPivot(
      [a, b],
      snapshot,
      [1, 1, 0],
      [4, 1, 0],
      [0, 0, 0, 1],
      [1, 1, 1],
    )
    expect(next[0].position).toEqual([3, 1, 0])
    expect(next[1].position).toEqual([5, 1, 0])
  })

  it('rotates selected points and their handles around the pivot', () => {
    const a = { ...makeAnchor([1, 0, 0]), manual: true, handleOut: [0.5, 0, 0] as [number, number, number] }
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    const next = transformAnchorsAroundPivot(
      [a],
      [{ id: a.id, position: a.position, handleIn: a.handleIn, handleOut: [...a.handleOut] }],
      [0, 0, 0],
      [0, 0, 0],
      [q.x, q.y, q.z, q.w],
      [1, 1, 1],
    )
    expect(next[0].position[0]).toBeCloseTo(0, 6)
    expect(next[0].position[1]).toBeCloseTo(0, 6)
    expect(next[0].position[2]).toBeCloseTo(-1, 6)
    expect(next[0].handleOut[0]).toBeCloseTo(0, 6)
    expect(next[0].handleOut[2]).toBeCloseTo(-0.5, 6)
  })

  it('scales selected points away from the pivot', () => {
    const a = makeAnchor([0, 0, 0])
    const b = makeAnchor([2, 0, 0])
    const snapshot = [
      { id: a.id, position: a.position, handleIn: a.handleIn, handleOut: a.handleOut },
      { id: b.id, position: b.position, handleIn: b.handleIn, handleOut: b.handleOut },
    ]
    const next = transformAnchorsAroundPivot([a, b], snapshot, [1, 0, 0], [1, 0, 0], [0, 0, 0, 1], [2, 1, 1])
    expect(next[0].position[0]).toBeCloseTo(-1, 6)
    expect(next[1].position[0]).toBeCloseTo(3, 6)
  })
})
