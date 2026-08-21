import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyDeleteShortcut, isKeyableShortcut } from './editorShortcuts'
import { insertKeyframeAtPlayhead } from './insertKeyframe'
import { useEditorStore } from '../state/useEditorStore'
import { usePathStore } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'

beforeEach(() => {
  useEditorStore.setState({
    selection: null,
    selectedKeyframe: null,
    keyableFocus: null,
    objectBarPanel: 'none',
    playMode: false,
  })
  usePathStore.setState({ selectedAnchorIds: [] })
  useSceneStore.setState({ objects: [], pendingLifts: [] })
  useRigStore.setState({ t: 0.4, fovKeys: [] })
})

afterEach(() => {
  useSceneStore.setState({ objects: [], pendingLifts: [] })
  useEditorStore.setState({
    selection: null,
    selectedKeyframe: null,
    keyableFocus: null,
    objectBarPanel: 'none',
    playMode: false,
  })
})

describe('isKeyableShortcut', () => {
  it('allows I and Delete through number fields', () => {
    expect(isKeyableShortcut('i')).toBe(true)
    expect(isKeyableShortcut('Delete')).toBe(true)
    expect(isKeyableShortcut('Backspace')).toBe(false)
    expect(isKeyableShortcut('w')).toBe(false)
  })
})

describe('applyDeleteShortcut', () => {
  it('deletes the selected object', () => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    useEditorStore.setState({ selection: `obj:${id}` })
    expect(applyDeleteShortcut('Delete', { keyableField: false })).toBe(true)
    expect(useSceneStore.getState().objects).toHaveLength(0)
    expect(useEditorStore.getState().selection).toBeNull()
  })

  it('deletes the object with Backspace when no field is focused', () => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    useEditorStore.setState({ selection: `obj:${id}` })
    expect(applyDeleteShortcut('Backspace', { keyableField: false })).toBe(true)
    expect(useSceneStore.getState().objects).toHaveLength(0)
  })

  it('does not delete the object while a number field is using Backspace', () => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    useEditorStore.setState({ selection: `obj:${id}` })
    expect(applyDeleteShortcut('Backspace', { keyableField: true })).toBe(false)
    expect(useSceneStore.getState().objects).toHaveLength(1)
  })

  it('does not delete the object with Delete in a number field when there is no key', () => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    useEditorStore.setState({
      selection: `obj:${id}`,
      objectBarPanel: 'transform',
      keyableFocus: 'object',
    })
    expect(applyDeleteShortcut('Delete', { keyableField: true })).toBe(false)
    expect(useSceneStore.getState().objects).toHaveLength(1)
  })

  it('removes a pose key with Delete when Transform is open, then the object', () => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    useEditorStore.setState({
      selection: `obj:${id}`,
      objectBarPanel: 'transform',
      keyableFocus: 'object',
    })
    insertKeyframeAtPlayhead()
    expect(useSceneStore.getState().objects[0].keys).toHaveLength(3)

    expect(applyDeleteShortcut('Delete', { keyableField: false })).toBe(true)
    expect(useSceneStore.getState().objects[0].keys).toHaveLength(0)
    expect(useSceneStore.getState().objects).toHaveLength(1)

    expect(applyDeleteShortcut('Delete', { keyableField: false })).toBe(true)
    expect(useSceneStore.getState().objects).toHaveLength(0)
  })
})
