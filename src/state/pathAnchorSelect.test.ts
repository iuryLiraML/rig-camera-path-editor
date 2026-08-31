import { beforeEach, describe, expect, it } from 'vitest'
import { snapshotWorldAnchors, worldAnchorPivot } from '../lib/anchorSelection'
import { CAMERA_PATH_ID, makeAnchor, usePathStore } from './usePathStore'
import { useEditorStore } from './useEditorStore'

const seedPath = () => {
  const a = makeAnchor([0, 1, 0])
  const b = makeAnchor([2, 1, 0])
  const c = makeAnchor([4, 1, 0])
  usePathStore.setState({
    paths: [
      {
        id: CAMERA_PATH_ID,
        name: 'Camera Path',
        closed: false,
        rounding: 0.8,
        anchors: [a, b, c],
      },
    ],
    activePathId: CAMERA_PATH_ID,
    selectedAnchorRefs: [],
    primaryAnchorRef: null,
    selectedAnchorId: null,
    selectedAnchorIds: [],
    selectedHandle: 'none',
  })
  return [a.id, b.id, c.id] as const
}

beforeEach(() => {
  seedPath()
})

describe('path anchor multi-select', () => {
  it('accumulates with additive select and moves the whole set', () => {
    const [a, , c] = usePathStore.getState().paths[0].anchors.map((anchor) => anchor.id)
    usePathStore.getState().selectAnchor(a, false)
    usePathStore.getState().selectAnchor(c, true)
    expect(usePathStore.getState().selectedAnchorIds).toEqual([a, c])
    expect(usePathStore.getState().selectedAnchorId).toBe(c)

    usePathStore.getState().translateSelectedAnchors([1, 0.5, -2])
    const anchors = usePathStore.getState().paths[0].anchors
    expect(anchors[0].position).toEqual([1, 1.5, -2])
    expect(anchors[1].position).toEqual([2, 1, 0])
    expect(anchors[2].position).toEqual([5, 1.5, -2])
  })

  it('keeps the set when clicking a member without additive (so a gizmo drag can move the group)', () => {
    const [a, b] = usePathStore.getState().paths[0].anchors.map((anchor) => anchor.id)
    usePathStore.getState().selectAnchor(a, false)
    usePathStore.getState().selectAnchor(b, true)
    usePathStore.getState().selectAnchor(a, false)
    expect(usePathStore.getState().selectedAnchorIds).toEqual([a, b])
  })

  it('applies a group transform from a snapshot so rotate/scale share one pivot', () => {
    const [a, b] = usePathStore.getState().paths[0].anchors
    usePathStore.getState().selectAnchor(a.id, false)
    usePathStore.getState().selectAnchor(b.id, true)
    usePathStore.getState().applyAnchorGroupTransform({
      snapshot: [
        { id: a.id, position: a.position, handleIn: a.handleIn, handleOut: a.handleOut },
        { id: b.id, position: b.position, handleIn: b.handleIn, handleOut: b.handleOut },
      ],
      startPivot: [1, 1, 0],
      currentPivot: [1, 3, 0],
      quat: [0, 0, 0, 1],
      scale: [1, 1, 1],
    })
    const anchors = usePathStore.getState().paths[0].anchors
    expect(anchors[0].position).toEqual([0, 3, 0])
    expect(anchors[1].position).toEqual([2, 3, 0])
    expect(anchors[2].position).toEqual([4, 1, 0])
  })

  it('clears spline points when the viewport deselects the scene', () => {
    const [a, b] = usePathStore.getState().paths[0].anchors
    usePathStore.getState().selectAnchor(a.id, false)
    usePathStore.getState().selectAnchor(b.id, true)
    useEditorStore.getState().select(null)
    expect(usePathStore.getState().selectedAnchorIds).toEqual([])
    expect(usePathStore.getState().selectedAnchorId).toBeNull()
  })

  it('keeps spline points when the path stays selected', () => {
    const [a, b] = usePathStore.getState().paths[0].anchors
    usePathStore.getState().selectAnchor(a.id, false)
    usePathStore.getState().selectAnchor(b.id, true)
    useEditorStore.getState().select('camera-path')
    expect(usePathStore.getState().selectedAnchorIds).toEqual([a.id, b.id])
  })

  it('stores ordered path-qualified references and maps the primary to the active path APIs', () => {
    const cameraAnchor = usePathStore.getState().paths[0].anchors[0]
    const otherPathId = usePathStore.getState().createPath('Other')
    const otherAnchorId = usePathStore.getState().addAnchor([8, 1, 0])

    usePathStore.getState().setSelectedAnchorRefs([
      { pathId: CAMERA_PATH_ID, anchorId: cameraAnchor.id },
      { pathId: otherPathId, anchorId: otherAnchorId },
    ])

    const state = usePathStore.getState()
    expect(state.selectedAnchorRefs).toEqual([
      { pathId: CAMERA_PATH_ID, anchorId: cameraAnchor.id },
      { pathId: otherPathId, anchorId: otherAnchorId },
    ])
    expect(state.primaryAnchorRef).toEqual({ pathId: otherPathId, anchorId: otherAnchorId })
    expect(state.activePathId).toBe(otherPathId)
    expect(state.selectedAnchorId).toBe(otherAnchorId)
    expect(state.selectedAnchorIds).toEqual([otherAnchorId])
  })

  it('removes duplicate path-anchor pairs without conflating equal anchor ids on different paths', () => {
    usePathStore.getState().setSelectedAnchorRefs([
      { pathId: CAMERA_PATH_ID, anchorId: 'shared' },
      { pathId: CAMERA_PATH_ID, anchorId: 'shared' },
      { pathId: 'other', anchorId: 'shared' },
    ])

    expect(usePathStore.getState().selectedAnchorRefs).toEqual([
      { pathId: CAMERA_PATH_ID, anchorId: 'shared' },
      { pathId: 'other', anchorId: 'shared' },
    ])
    expect(usePathStore.getState().primaryAnchorRef).toEqual({
      pathId: 'other',
      anchorId: 'shared',
    })
  })

  it('prunes unavailable references and deterministically promotes the final survivor', () => {
    const [a, b] = usePathStore.getState().paths[0].anchors
    const otherPathId = usePathStore.getState().createPath('Other')
    const otherAnchorId = usePathStore.getState().addAnchor([8, 1, 0])
    usePathStore.getState().setSelectedAnchorRefs([
      { pathId: CAMERA_PATH_ID, anchorId: a.id },
      { pathId: CAMERA_PATH_ID, anchorId: b.id },
      { pathId: otherPathId, anchorId: otherAnchorId },
    ])

    usePathStore.setState((state) => ({
      paths: state.paths.filter((path) => path.id !== otherPathId),
    }))
    usePathStore.getState().pruneSelectedAnchorRefs()

    const state = usePathStore.getState()
    expect(state.selectedAnchorRefs).toEqual([
      { pathId: CAMERA_PATH_ID, anchorId: a.id },
      { pathId: CAMERA_PATH_ID, anchorId: b.id },
    ])
    expect(state.primaryAnchorRef).toEqual({ pathId: CAMERA_PATH_ID, anchorId: b.id })
    expect(state.activePathId).toBe(CAMERA_PATH_ID)
    expect(state.selectedAnchorId).toBe(b.id)
    expect(state.selectedAnchorIds).toEqual([a.id, b.id])
  })

  it('maps the deterministic primary point to the active point and path', () => {
    const cameraAnchor = usePathStore.getState().paths[0].anchors[0]
    const otherPathId = usePathStore.getState().createPath('Other')
    const otherAnchorId = usePathStore.getState().addAnchor([8, 1, 0])

    usePathStore.getState().setSelectedAnchorRefs([
      { pathId: otherPathId, anchorId: otherAnchorId },
      { pathId: CAMERA_PATH_ID, anchorId: cameraAnchor.id },
    ])

    expect(usePathStore.getState()).toMatchObject({
      activePathId: CAMERA_PATH_ID,
      selectedAnchorId: cameraAnchor.id,
      selectedAnchorIds: [cameraAnchor.id],
      primaryAnchorRef: { pathId: CAMERA_PATH_ID, anchorId: cameraAnchor.id },
    })
  })

  it('uses the existing active-path transform fast path without changing another path', () => {
    const [a, b] = usePathStore.getState().paths[0].anchors
    const other = { ...makeAnchor([20, 1, 0]), id: 'other-anchor' }
    usePathStore.setState((state) => ({
      paths: [
        ...state.paths,
        { id: 'other-path', name: 'Other', anchors: [other], closed: false, rounding: 0.8 },
      ],
    }))
    usePathStore.getState().setSelectedAnchorRefs([
      { pathId: CAMERA_PATH_ID, anchorId: a.id },
      { pathId: CAMERA_PATH_ID, anchorId: b.id },
    ])
    usePathStore.getState().applyAnchorGroupTransform({
      snapshot: [
        { id: a.id, position: a.position, handleIn: a.handleIn, handleOut: a.handleOut },
        { id: b.id, position: b.position, handleIn: b.handleIn, handleOut: b.handleOut },
      ],
      startPivot: [1, 1, 0],
      currentPivot: [4, 1, 0],
      quat: [0, 0, 0, 1],
      scale: [1, 1, 1],
    })

    expect(usePathStore.getState().paths.find((path) => path.id === CAMERA_PATH_ID)?.anchors[0].position)
      .toEqual([3, 1, 0])
    expect(usePathStore.getState().paths.find((path) => path.id === 'other-path')?.anchors[0])
      .toEqual(other)
  })

  it('writes one immutable world-space group transform back to every owning path', () => {
    const left = { ...makeAnchor([-1, 0, 0]), id: 'left' }
    const right = { ...makeAnchor([1, 0, 0]), id: 'right' }
    usePathStore.setState({
      paths: [
        { id: 'left-path', name: 'Left', anchors: [left], closed: false, rounding: 0.8 },
        { id: 'right-path', name: 'Right', anchors: [right], closed: false, rounding: 0.8 },
      ],
      activePathId: 'right-path',
    })
    const snapshot = snapshotWorldAnchors(
      [
        { pathId: 'left-path', anchors: [left], parent: null },
        { pathId: 'right-path', anchors: [right], parent: null },
      ],
      [
        { pathId: 'left-path', anchorId: 'left' },
        { pathId: 'right-path', anchorId: 'right' },
      ],
    )
    const before = structuredClone(snapshot)

    usePathStore.getState().applyWorldAnchorGroupTransform({
      snapshot,
      startPivot: [0, 0, 0],
      currentPivot: [2, 3, 0],
      quat: [0, 0, 0, 1],
      scale: [2, 1, 1],
    })

    expect(usePathStore.getState().paths[0].anchors[0].position).toEqual([0, 3, 0])
    expect(usePathStore.getState().paths[1].anchors[0].position).toEqual([4, 3, 0])
    expect(snapshot).toEqual(before)
  })

  it('prunes a hidden path and promotes the final visible point and active path', () => {
    const [cameraAnchor] = usePathStore.getState().paths[0].anchors
    const hiddenPathId = usePathStore.getState().createPath('Hidden route')
    const hiddenAnchorId = usePathStore.getState().addAnchor([8, 1, 0])
    usePathStore.getState().setSelectedAnchorRefs([
      { pathId: CAMERA_PATH_ID, anchorId: cameraAnchor.id },
      { pathId: hiddenPathId, anchorId: hiddenAnchorId },
    ])

    useEditorStore.getState().toggleHidden(`path:${hiddenPathId}`)

    expect(usePathStore.getState()).toMatchObject({
      selectedAnchorRefs: [{ pathId: CAMERA_PATH_ID, anchorId: cameraAnchor.id }],
      primaryAnchorRef: { pathId: CAMERA_PATH_ID, anchorId: cameraAnchor.id },
      activePathId: CAMERA_PATH_ID,
      selectedAnchorId: cameraAnchor.id,
      selectedAnchorIds: [cameraAnchor.id],
    })
  })

  it('prunes only a removed path and deterministically promotes the final survivor', () => {
    const [a, b] = usePathStore.getState().paths[0].anchors
    const removedPathId = usePathStore.getState().createPath('Disposable')
    const removedAnchorId = usePathStore.getState().addAnchor([8, 1, 0])
    usePathStore.getState().setSelectedAnchorRefs([
      { pathId: CAMERA_PATH_ID, anchorId: a.id },
      { pathId: CAMERA_PATH_ID, anchorId: b.id },
      { pathId: removedPathId, anchorId: removedAnchorId },
    ])

    usePathStore.getState().removePath(removedPathId)

    expect(usePathStore.getState()).toMatchObject({
      selectedAnchorRefs: [
        { pathId: CAMERA_PATH_ID, anchorId: a.id },
        { pathId: CAMERA_PATH_ID, anchorId: b.id },
      ],
      primaryAnchorRef: { pathId: CAMERA_PATH_ID, anchorId: b.id },
      activePathId: CAMERA_PATH_ID,
      selectedAnchorId: b.id,
      selectedAnchorIds: [a.id, b.id],
    })
  })

  it('prunes a removed anchor and recalculates the selected-point pivot', () => {
    const [a, b, c] = usePathStore.getState().paths[0].anchors
    usePathStore.getState().setSelectedAnchorRefs([
      { pathId: CAMERA_PATH_ID, anchorId: a.id },
      { pathId: CAMERA_PATH_ID, anchorId: b.id },
      { pathId: CAMERA_PATH_ID, anchorId: c.id },
    ])

    usePathStore.getState().removeAnchor(c.id)

    const state = usePathStore.getState()
    const snapshot = snapshotWorldAnchors(
      state.paths.map((path) => ({ pathId: path.id, anchors: path.anchors, parent: null })),
      state.selectedAnchorRefs,
    )
    expect(state.primaryAnchorRef).toEqual({ pathId: CAMERA_PATH_ID, anchorId: b.id })
    expect(state.activePathId).toBe(CAMERA_PATH_ID)
    expect(worldAnchorPivot(snapshot)).toEqual([1, 1, 0])
  })

  it('keeps Shift-click additive point selection and deterministic click order', () => {
    const [a, b, c] = usePathStore.getState().paths[0].anchors

    usePathStore.getState().selectAnchor(a.id, false)
    usePathStore.getState().selectAnchor(c.id, true)
    usePathStore.getState().selectAnchor(b.id, true)

    expect(usePathStore.getState()).toMatchObject({
      selectedAnchorRefs: [
        { pathId: CAMERA_PATH_ID, anchorId: a.id },
        { pathId: CAMERA_PATH_ID, anchorId: c.id },
        { pathId: CAMERA_PATH_ID, anchorId: b.id },
      ],
      primaryAnchorRef: { pathId: CAMERA_PATH_ID, anchorId: b.id },
      selectedAnchorIds: [a.id, c.id, b.id],
    })
  })

  it('keeps lasso-selected points on other paths when Shift-click adds an active-path anchor', () => {
    const [cameraAnchor] = usePathStore.getState().paths[0].anchors
    const otherPathId = usePathStore.getState().createPath('Other')
    const firstOther = usePathStore.getState().addAnchor([8, 1, 0])
    const secondOther = usePathStore.getState().addAnchor([10, 1, 0])
    usePathStore.getState().setSelectedAnchorRefs([
      { pathId: CAMERA_PATH_ID, anchorId: cameraAnchor.id },
      { pathId: otherPathId, anchorId: firstOther },
    ])

    usePathStore.getState().selectAnchor(secondOther, true)

    expect(usePathStore.getState()).toMatchObject({
      selectedAnchorRefs: [
        { pathId: CAMERA_PATH_ID, anchorId: cameraAnchor.id },
        { pathId: otherPathId, anchorId: firstOther },
        { pathId: otherPathId, anchorId: secondOther },
      ],
      primaryAnchorRef: { pathId: otherPathId, anchorId: secondOther },
      selectedAnchorIds: [firstOther, secondOther],
    })
  })
})
