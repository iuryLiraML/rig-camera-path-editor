import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteKeyframeAtPlayhead,
  deleteSelectedTimelineKey,
  insertChannelKeyAt,
} from './timelineKey'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'

beforeEach(() => {
  useEditorStore.setState({
    selectedKeyframe: null,
    selection: 'cinema-camera',
    keyableFocus: null,
    objectBarPanel: 'none',
    playMode: false,
  })
  useSceneStore.setState({ objects: [], pendingLifts: [] })
  useRigStore.setState({
    t: 0.4,
    fov: 45,
    fovKeys: [],
    rollKeys: [],
    progressKeys: [],
    intensityKeys: [],
    fadeInKeys: [],
    fadeOutKeys: [],
    ampPosKeys: [],
    ampRotKeys: [],
    freqKeys: [],
    targetKeys: [],
    lookOffsetKeys: [],
  })
})

describe('insertChannelKeyAt', () => {
  it('adds an FOV key on an empty channel', () => {
    insertChannelKeyAt('fov', 0.25)
    const keys = useRigStore.getState().fovKeys
    expect(keys).toHaveLength(1)
    expect(keys[0].time).toBeCloseTo(0.25, 5)
    expect(keys[0].value).toBeCloseTo(45, 5)
  })
})

describe('deleteSelectedTimelineKey', () => {
  it('removes the selected rig key and clears the selection', () => {
    insertChannelKeyAt('fov', 0.4)
    const id = useRigStore.getState().fovKeys[0].id
    useEditorStore.getState().selectTimelineKey({ kind: 'rig', channel: 'fov', id }, 'cinema-camera')
    expect(deleteSelectedTimelineKey()).toBe(true)
    expect(useRigStore.getState().fovKeys).toHaveLength(0)
    expect(useEditorStore.getState().selectedKeyframe).toBeNull()
  })

  it('does nothing when no key is selected', () => {
    expect(deleteSelectedTimelineKey()).toBe(false)
  })
})

describe('deleteKeyframeAtPlayhead', () => {
  it('removes a focused camera channel key at the playhead', () => {
    insertChannelKeyAt('fov', 0.4)
    useEditorStore.setState({ keyableFocus: 'fov' })
    expect(deleteKeyframeAtPlayhead()).toBe(true)
    expect(useRigStore.getState().fovKeys).toHaveLength(0)
  })

  it('removes an object pose key when Transform is open', () => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    useSceneStore.getState().addObjectKey(id, 0.4)
    useEditorStore.setState({
      selection: `obj:${id}`,
      objectBarPanel: 'transform',
      keyableFocus: 'object',
    })
    expect(deleteKeyframeAtPlayhead()).toBe(true)
    expect(useSceneStore.getState().objects[0].keys).toHaveLength(0)
  })

  it('leaves pose keys alone when Transform is closed and nothing is focused', () => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    useSceneStore.getState().addObjectKey(id, 0.4)
    useEditorStore.setState({
      selection: `obj:${id}`,
      objectBarPanel: 'none',
      keyableFocus: null,
    })
    expect(deleteKeyframeAtPlayhead()).toBe(false)
    expect(useSceneStore.getState().objects[0].keys).toHaveLength(1)
  })
})
