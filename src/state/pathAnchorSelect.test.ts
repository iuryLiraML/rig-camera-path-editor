import { beforeEach, describe, expect, it } from 'vitest'
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
})
