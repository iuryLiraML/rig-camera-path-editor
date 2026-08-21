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
    staticPosKeys: [],
    staticRotKeys: [],
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

  it('adds a Free-camera position key from the rest pose', () => {
    useRigStore.setState({
      staticPose: { position: [2, 3, 4], rotation: [0, 0, 0] },
      staticPosKeys: [],
    })
    insertChannelKeyAt('staticPos', 0.25)
    const keys = useRigStore.getState().staticPosKeys
    expect(keys).toHaveLength(1)
    expect(keys[0].time).toBeCloseTo(0.25, 5)
    expect(keys[0].value).toEqual([2, 3, 4])
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

  it('removes a Free-camera rotation key at the playhead', () => {
    insertChannelKeyAt('staticRot', 0.4)
    useEditorStore.setState({ keyableFocus: 'staticRot' })
    expect(deleteKeyframeAtPlayhead()).toBe(true)
    expect(useRigStore.getState().staticRotKeys).toHaveLength(0)
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

  it('splits a selected pose key when Position is focused', () => {
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
      selectedKeyframe: { kind: 'object', objectId: object.id, id: 'legacy-pose' },
    })
    expect(deleteSelectedTimelineKey()).toBe(true)
    expect(useSceneStore.getState().objects[0].keys.map((k) => k.channel).sort()).toEqual([
      'rotation',
      'scale',
    ])
  })

  it('removes only the focused transform channel at the playhead', () => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    useSceneStore.getState().addObjectKey(id, 0.4)
    useEditorStore.setState({
      selection: `obj:${id}`,
      objectBarPanel: 'transform',
      keyableFocus: 'objectPosition',
    })
    expect(useSceneStore.getState().objects[0].keys).toHaveLength(3)
    expect(deleteKeyframeAtPlayhead()).toBe(true)
    const leftover = useSceneStore.getState().objects[0].keys
    expect(leftover.map((k) => k.channel).sort()).toEqual(['rotation', 'scale'])
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
    expect(useSceneStore.getState().objects[0].keys).toHaveLength(3)
  })
})
