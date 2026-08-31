import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './useEditorStore'
import { CAMERA_PATH_ID, usePathStore } from './usePathStore'

describe('editor multi-selection', () => {
  beforeEach(() => {
    usePathStore.setState({
      paths: [
        { id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 },
        { id: 'route-b', name: 'Route B', anchors: [], closed: false, rounding: 0.8 },
      ],
      activePathId: CAMERA_PATH_ID,
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

  it('clears both active and member selection', () => {
    useEditorStore.getState().selectMany(['obj:first', 'obj:second'])
    useEditorStore.getState().select(null)

    expect(useEditorStore.getState().selection).toBeNull()
    expect(useEditorStore.getState().selectionIds).toEqual([])
  })
})
