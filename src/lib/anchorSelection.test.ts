import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  centroidOf,
  clickAnchorSelection,
  primaryAnchorId,
  snapshotWorldAnchors,
  toggleAnchorSelection,
  transformAnchorsAroundPivot,
  transformWorldAnchorSnapshots,
  translateAnchors,
  worldAnchorPivot,
} from './anchorSelection'
import { useEditorStore } from '../state/useEditorStore'
import { CAMERA_PATH_ID, makeAnchor, usePathStore } from '../state/usePathStore'

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

  it('leaves selected object transforms numerically unchanged during a local point transform', () => {
    const objectTransforms = [
      {
        position: [7.25, -2.5, 11.75],
        rotation: [15, 37.5, -22],
        scale: [1.5, 0.75, 2.25],
      },
      {
        position: [-4, 8.125, 0.5],
        rotation: [-90, 0.25, 180],
        scale: [0.5, 3, 1],
      },
    ] as const
    const before = structuredClone(objectTransforms)
    const anchor = makeAnchor([1, 0, 0])

    transformAnchorsAroundPivot(
      [anchor],
      [{
        id: anchor.id,
        position: anchor.position,
        handleIn: anchor.handleIn,
        handleOut: anchor.handleOut,
      }],
      [0, 0, 0],
      [3, 4, 5],
      [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      [2, 3, 4],
    )

    expect(objectTransforms).toEqual(before)
  })

  it('snapshots multi-path anchors in world space and computes one shared pivot', () => {
    const a = { ...makeAnchor([1, 0, 0]), id: 'a' }
    const b = { ...makeAnchor([1, 0, 0]), id: 'b' }
    const snapshots = snapshotWorldAnchors(
      [
        { pathId: 'plain', anchors: [a], parent: null },
        {
          pathId: 'parented',
          anchors: [b],
          parent: {
            position: [3, 0, 0],
            rotation: [0, 0, 0],
            scale: [2, 1, 1],
          },
        },
      ],
      [
        { pathId: 'plain', anchorId: 'a' },
        { pathId: 'parented', anchorId: 'b' },
      ],
    )

    expect(snapshots.map((snapshot) => snapshot.worldPosition)).toEqual([
      [1, 0, 0],
      [5, 0, 0],
    ])
    expect(worldAnchorPivot(snapshots)).toEqual([3, 0, 0])
  })

  it('moves parented multi-path anchors by the same world displacement without mutating snapshots', () => {
    const a = { ...makeAnchor([0, 0, 0]), id: 'a' }
    const b = { ...makeAnchor([0, 0, 0]), id: 'b' }
    const snapshots = snapshotWorldAnchors(
      [
        { pathId: 'plain', anchors: [a], parent: null },
        {
          pathId: 'parented',
          anchors: [b],
          parent: {
            position: [4, 0, 0],
            rotation: [0, 90, 0],
            scale: [2, 1, 1],
          },
        },
      ],
      [
        { pathId: 'plain', anchorId: 'a' },
        { pathId: 'parented', anchorId: 'b' },
      ],
    )
    const before = structuredClone(snapshots)
    const next = transformWorldAnchorSnapshots(
      snapshots,
      [2, 0, 0],
      [3, 2, -1],
      [0, 0, 0, 1],
      [1, 1, 1],
    )

    expect(next.get('plain')?.[0].position).toEqual([1, 2, -1])
    expect(next.get('parented')?.[0].position[0]).toBeCloseTo(0.5, 6)
    expect(next.get('parented')?.[0].position[1]).toBeCloseTo(2, 6)
    expect(next.get('parented')?.[0].position[2]).toBeCloseTo(1, 6)
    expect(snapshots).toEqual(before)
  })

  it('rotates and scales multi-path anchors around the shared world pivot', () => {
    const left = { ...makeAnchor([-1, 0, 0]), id: 'left' }
    const right = { ...makeAnchor([1, 0, 0]), id: 'right' }
    const snapshots = snapshotWorldAnchors(
      [
        { pathId: 'left-path', anchors: [left], parent: null },
        { pathId: 'right-path', anchors: [right], parent: null },
      ],
      [
        { pathId: 'left-path', anchorId: 'left' },
        { pathId: 'right-path', anchorId: 'right' },
      ],
    )
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
    const next = transformWorldAnchorSnapshots(
      snapshots,
      worldAnchorPivot(snapshots),
      [0, 0, 0],
      [q.x, q.y, q.z, q.w],
      [2, 1, 1],
    )
    const leftPosition = next.get('left-path')![0].position
    const rightPosition = next.get('right-path')![0].position

    expect(leftPosition[0]).toBeCloseTo(0, 6)
    expect(leftPosition[1]).toBeCloseTo(-2, 6)
    expect(rightPosition[0]).toBeCloseTo(0, 6)
    expect(rightPosition[1]).toBeCloseTo(2, 6)
    expect(new THREE.Vector3(...leftPosition).distanceTo(new THREE.Vector3(...rightPosition))).toBeCloseTo(4, 6)
  })

  it('leaves selected object transforms numerically unchanged during a world point transform', () => {
    const objectTransforms = [
      {
        position: [12.5, 2, -6.75],
        rotation: [5, -120, 42],
        scale: [0.8, 1.2, 1.6],
      },
    ] as const
    const before = structuredClone(objectTransforms)
    const anchor = { ...makeAnchor([1, 2, 3]), id: 'point' }
    const snapshots = snapshotWorldAnchors(
      [{ pathId: 'route', anchors: [anchor], parent: null }],
      [{ pathId: 'route', anchorId: 'point' }],
    )

    transformWorldAnchorSnapshots(
      snapshots,
      [1, 2, 3],
      [-3, 5, 9],
      [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      [1.5, 0.5, 2],
    )

    expect(objectTransforms).toEqual(before)
  })

  it('moves the active mixed-selection points without changing its selected object transform', () => {
    const anchor = { ...makeAnchor([1, 2, 3]), id: 'point' }
    const objectTransform = {
      position: [8.5, -3.25, 4.75],
      rotation: [12, 34, 56],
      scale: [1.25, 0.75, 2],
    } as const
    const objectBefore = structuredClone(objectTransform)
    usePathStore.setState({
      paths: [{
        id: CAMERA_PATH_ID,
        name: 'Camera Path',
        anchors: [anchor],
        closed: false,
        rounding: 0.8,
      }],
      activePathId: CAMERA_PATH_ID,
      selectedAnchorRefs: [],
      primaryAnchorRef: null,
      selectedAnchorId: null,
      selectedAnchorIds: [],
      selectedHandle: 'none',
    })
    useEditorStore.setState({ selection: null, selectionIds: [] })

    useEditorStore.getState().selectMany(
      ['obj:subject'],
      [{ pathId: CAMERA_PATH_ID, anchorId: anchor.id }],
    )
    const snapshots = snapshotWorldAnchors(
      [{ pathId: CAMERA_PATH_ID, anchors: [anchor], parent: null }],
      usePathStore.getState().selectedAnchorRefs,
    )
    const next = transformWorldAnchorSnapshots(
      snapshots,
      anchor.position,
      [4, 5, 6],
      [0, 0, 0, 1],
      [1, 1, 1],
    )

    expect(next.get(CAMERA_PATH_ID)?.[0].position).toEqual([4, 5, 6])
    expect(objectTransform).toEqual(objectBefore)
  })
})
