// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyDeleteShortcut,
  applyHelpShortcut,
  applySaveShortcut,
  applyTimelineShortcut,
  isKeyableShortcut,
  SHORTCUT_ROWS,
} from './editorShortcuts'
import { insertKeyframeAtPlayhead } from './insertKeyframe'
import { useSaveStatusStore } from './saveStatus'
import { useEditorStore } from '../state/useEditorStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
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
    workspaceMode: 'build',
    composeDock: 'sequence',
    timelineGraph: false,
    showShortcuts: false,
  })
  usePathStore.setState({ selectedAnchorIds: [] })
  useSceneStore.setState({ objects: [], pendingLifts: [] })
  useRigStore.setState({ t: 0.4, fovKeys: [] })
  useEnvironmentStore.setState({ environmentId: null })
})

afterEach(() => {
  useSceneStore.setState({ objects: [], pendingLifts: [] })
  useEnvironmentStore.setState({ environmentId: null })
  useEditorStore.setState({
    selection: null,
    selectedKeyframe: null,
    keyableFocus: null,
    objectBarPanel: 'none',
    playMode: false,
    workspaceMode: 'build',
    composeDock: 'sequence',
    timelineGraph: false,
    showShortcuts: false,
  })
})

function key(init: KeyboardEventInit) {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
}

describe('isKeyableShortcut', () => {
  it('allows I and Delete through number fields', () => {
    expect(isKeyableShortcut('i')).toBe(true)
    expect(isKeyableShortcut('Delete')).toBe(true)
    expect(isKeyableShortcut('Backspace')).toBe(false)
    expect(isKeyableShortcut('w')).toBe(false)
    expect(isKeyableShortcut('t')).toBe(false)
    expect(isKeyableShortcut('?')).toBe(false)
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

  it('unkeys only the focused transform channel, then deletes the object', () => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    useEditorStore.setState({
      selection: `obj:${id}`,
      objectBarPanel: 'transform',
      keyableFocus: 'objectPosition',
    })
    insertKeyframeAtPlayhead()
    expect(useSceneStore.getState().objects[0].keys.map((k) => k.channel)).toEqual(['position'])

    expect(applyDeleteShortcut('Delete', { keyableField: false })).toBe(true)
    expect(useSceneStore.getState().objects[0].keys).toHaveLength(0)
    expect(useSceneStore.getState().objects).toHaveLength(1)

    expect(applyDeleteShortcut('Delete', { keyableField: false })).toBe(true)
    expect(useSceneStore.getState().objects).toHaveLength(0)
  })

  it('splits a legacy pose key when Delete hits a focused channel', () => {
    useSceneStore.getState().addPrimitive('box')
    const object = useSceneStore.getState().objects[0]
    useSceneStore.setState({
      objects: [
        {
          ...object,
          keys: [{ id: 'legacy-pose', time: 0.4, transform: { ...object.transform } }],
        },
      ],
    })
    useEditorStore.setState({
      selection: `obj:${object.id}`,
      objectBarPanel: 'transform',
      keyableFocus: 'objectPosition',
    })
    insertKeyframeAtPlayhead()
    const keyed = useSceneStore.getState().objects[0].keys
    expect(keyed.some((k) => k.channel === 'position')).toBe(true)
    expect(keyed.some((k) => !k.channel)).toBe(true)

    expect(applyDeleteShortcut('Delete', { keyableField: false })).toBe(true)
    const leftover = useSceneStore.getState().objects[0].keys
    expect(leftover.map((k) => k.channel).sort()).toEqual(['rotation', 'scale'])
    expect(useSceneStore.getState().objects).toHaveLength(1)
  })

  it('clears the palco when Environment is selected', () => {
    useEnvironmentStore.setState({ environmentId: 'beach' })
    useEditorStore.setState({ selection: 'env' })
    expect(applyDeleteShortcut('Delete', { keyableField: false })).toBe(true)
    expect(useEnvironmentStore.getState().environmentId).toBeNull()
    expect(useEditorStore.getState().selection).toBeNull()
  })
})

describe('shortcut handlers', () => {
  it('lists the Compose cheat-sheet rows', () => {
    expect(SHORTCUT_ROWS.map((row) => row.keys)).toEqual([
      'I',
      'Delete',
      'WASD / arrows',
      'Space',
      'P',
      'D',
      'Shift+drag',
      'W E R',
      'T',
      'Shift+T',
      '?',
      'Ctrl/Cmd+S',
      'Ctrl/Cmd+Z / Y',
    ])
  })

  it('opens Compose Timeline on T', () => {
    const event = key({ key: 't' })
    expect(applyTimelineShortcut(event)).toBe(true)
    expect(useEditorStore.getState().workspaceMode).toBe('compose')
    expect(useEditorStore.getState().composeDock).toBe('timeline')
    expect(useEditorStore.getState().timelineGraph).toBe(false)
  })

  it('toggles the Graph Editor on Shift+T', () => {
    const event = key({ key: 'T', shiftKey: true })
    expect(applyTimelineShortcut(event)).toBe(true)
    expect(useEditorStore.getState().composeDock).toBe('timeline')
    expect(useEditorStore.getState().timelineGraph).toBe(true)
  })

  it('toggles the shortcuts overlay on ?', () => {
    expect(applyHelpShortcut(key({ key: '?' }))).toBe(true)
    expect(useEditorStore.getState().showShortcuts).toBe(true)
    expect(applyHelpShortcut(key({ key: '?' }))).toBe(true)
    expect(useEditorStore.getState().showShortcuts).toBe(false)
  })

  it('handles Ctrl+S without throwing', () => {
    useSaveStatusStore.setState({ status: 'dirty' })
    expect(applySaveShortcut(key({ key: 's', ctrlKey: true }))).toBe(true)
  })
})
