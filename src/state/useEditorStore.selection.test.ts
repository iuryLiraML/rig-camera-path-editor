import { beforeEach, describe, expect, it } from 'vitest'
import {
  isObjectGizmoActive,
  isPointGizmoActive,
  useEditorStore,
} from './useEditorStore'
import { CAMERA_PATH_ID, usePathStore } from './usePathStore'

describe('editor multi-selection', () => {
  beforeEach(() => {
    usePathStore.setState({
      paths: [
        { id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 },
        { id: 'route-b', name: 'Route B', anchors: [], closed: false, rounding: 0.8 },
      ],
      activePathId: CAMERA_PATH_ID,
      selectedAnchorRefs: [],
      primaryAnchorRef: null,
      selectedAnchorId: null,
      selectedAnchorIds: [],
      selectedHandle: 'none',
    })
    useEditorStore.setState({ selection: null, selectionIds: [], dummyBone: null })
  })

  it('normal selection replaces the ordered member set', () => {
    const editor = useEditorStore.getState()
    editor.selectMany(['obj:first', 'obj:second'])
    editor.select('obj:third')

    expect(useEditorStore.getState().selectionIds).toEqual(['obj:third'])
    expect(useEditorStore.getState().selection).toBe('obj:third')
  })

  it('lasso selection keeps deterministic order and makes the final hit active', () => {
    useEditorStore.getState().selectMany(['obj:first', 'path:route-b', 'obj:second', 'obj:first'])

    expect(useEditorStore.getState().selectionIds).toEqual([
      'obj:first',
      'path:route-b',
      'obj:second',
    ])
    expect(useEditorStore.getState().selection).toBe('obj:second')
  })

  it('maps an active path member to camera-path and activates that path', () => {
    useEditorStore.getState().selectMany(['obj:first', 'path:route-b'])

    expect(useEditorStore.getState().selection).toBe('camera-path')
    expect(useEditorStore.getState().selectionIds).toEqual(['obj:first', 'path:route-b'])
    expect(usePathStore.getState().activePathId).toBe('route-b')
  })

  it('retains ordered object and curve members while the final anchor owns the active context', () => {
    useEditorStore.getState().selectMany(
      ['obj:first', 'path:route-b', 'obj:second', 'obj:first'],
      [
        { pathId: CAMERA_PATH_ID, anchorId: 'camera-a' },
        { pathId: 'route-b', anchorId: 'route-b-a' },
        { pathId: CAMERA_PATH_ID, anchorId: 'camera-a' },
      ],
    )

    expect(useEditorStore.getState()).toMatchObject({
      selectionIds: ['obj:first', 'path:route-b', 'obj:second'],
      selection: 'camera-path',
    })
    expect(usePathStore.getState()).toMatchObject({
      activePathId: 'route-b',
      selectedAnchorRefs: [
        { pathId: CAMERA_PATH_ID, anchorId: 'camera-a' },
        { pathId: 'route-b', anchorId: 'route-b-a' },
      ],
      primaryAnchorRef: { pathId: 'route-b', anchorId: 'route-b-a' },
    })
    expect(isPointGizmoActive(
      useEditorStore.getState().selection,
      usePathStore.getState().primaryAnchorRef,
    )).toBe(true)
    expect(isObjectGizmoActive(useEditorStore.getState().selection, 'first')).toBe(false)
    expect(isObjectGizmoActive(useEditorStore.getState().selection, 'second')).toBe(false)
  })

  it('makes the final top-level member active when an atomic result has no anchors', () => {
    usePathStore.getState().setSelectedAnchorRefs([
      { pathId: 'route-b', anchorId: 'route-b-a' },
    ])

    useEditorStore.getState().selectMany(
      ['path:route-b', 'obj:first'],
      [],
    )

    expect(useEditorStore.getState()).toMatchObject({
      selectionIds: ['path:route-b', 'obj:first'],
      selection: 'obj:first',
    })
    expect(usePathStore.getState().selectedAnchorRefs).toEqual([])
    expect(isObjectGizmoActive(useEditorStore.getState().selection, 'first')).toBe(true)
    expect(isPointGizmoActive(
      useEditorStore.getState().selection,
      usePathStore.getState().primaryAnchorRef,
    )).toBe(false)
  })

  it('clears both active and member selection', () => {
    useEditorStore.getState().selectMany(
      ['obj:first', 'obj:second'],
      [{ pathId: 'route-b', anchorId: 'route-b-a' }],
    )
    useEditorStore.getState().select(null)

    expect(useEditorStore.getState().selection).toBeNull()
    expect(useEditorStore.getState().selectionIds).toEqual([])
    expect(usePathStore.getState().selectedAnchorRefs).toEqual([])
    expect(usePathStore.getState().primaryAnchorRef).toBeNull()
  })
})
