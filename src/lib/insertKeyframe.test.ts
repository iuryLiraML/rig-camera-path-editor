import { beforeEach, describe, expect, it } from 'vitest'
import { insertKeyframeAtPlayhead } from './insertKeyframe'
import { emptyVec3AxisKeyState } from './vec3Axes'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'

beforeEach(() => {
  useEditorStore.setState({
    keyableFocus: null,
    selection: 'cinema-camera',
    selectedKeyframe: null,
    objectBarPanel: 'none',
    timelineGraph: false,
  })
  useSceneStore.setState({ objects: [], pendingLifts: [] })
  useRigStore.setState({
    t: 0.4,
    intensityKeys: [],
    fadeInKeys: [],
    fadeOutKeys: [],
    ampPosKeys: [],
    ampRotKeys: [],
    freqKeys: [],
    fovKeys: [],
    rollKeys: [],
    progressKeys: [],
    ...emptyVec3AxisKeyState(),
    cameraNoise: {
      ...useRigStore.getState().cameraNoise,
      intensity: 0.7,
      ampPos: 0.12,
      enabled: true,
    },
  })
})

describe('insertKeyframeAtPlayhead', () => {
  it('writes an intensity key when Amount is focused', () => {
    useEditorStore.setState({ keyableFocus: 'intensity' })
    insertKeyframeAtPlayhead()
    const keys = useRigStore.getState().intensityKeys
    expect(keys).toHaveLength(1)
    expect(keys[0].time).toBeCloseTo(0.4, 5)
    expect(keys[0].value).toBeCloseTo(0.7, 5)
  })

  it('writes an ampPos key when Pos is focused', () => {
    useEditorStore.setState({ keyableFocus: 'ampPos' })
    insertKeyframeAtPlayhead()
    const keys = useRigStore.getState().ampPosKeys
    expect(keys).toHaveLength(1)
    expect(keys[0].time).toBeCloseTo(0.4, 5)
    expect(keys[0].value).toBeCloseTo(0.12, 5)
  })

  it('writes a fadeIn key when Fade in is focused', () => {
    useRigStore.setState({
      cameraNoise: { ...useRigStore.getState().cameraNoise, fadeIn: 0.8 },
    })
    useEditorStore.setState({ keyableFocus: 'fadeIn' })
    insertKeyframeAtPlayhead()
    const keys = useRigStore.getState().fadeInKeys
    expect(keys).toHaveLength(1)
    expect(keys[0].time).toBeCloseTo(0.4, 5)
    expect(keys[0].value).toBeCloseTo(0.8, 5)
  })

  it('writes all Look Offset axes when that row is focused', () => {
    useRigStore.setState({
      lookOffset: [0, 1.2, 0],
      ...emptyVec3AxisKeyState(),
    })
    useEditorStore.setState({ keyableFocus: 'lookOffsetY', timelineGraph: false })
    insertKeyframeAtPlayhead()
    expect(useRigStore.getState().lookOffsetXKeys).toHaveLength(1)
    expect(useRigStore.getState().lookOffsetYKeys).toHaveLength(1)
    expect(useRigStore.getState().lookOffsetZKeys).toHaveLength(1)
    expect(useRigStore.getState().lookOffsetYKeys[0].time).toBeCloseTo(0.4, 5)
    expect(useRigStore.getState().lookOffsetYKeys[0].value).toBeCloseTo(1.2, 5)
  })

  it('writes all transform channels when an object is selected', () => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    useEditorStore.setState({ keyableFocus: null, selection: `obj:${id}` })
    insertKeyframeAtPlayhead()
    const object = useSceneStore.getState().objects[0]
    expect(object.keys).toHaveLength(3)
    expect(object.keys.map((k) => k.channel).sort()).toEqual(['position', 'rotation', 'scale'])
    expect(object.keys[0].time).toBeCloseTo(0.4, 5)
    expect(useEditorStore.getState().selectedKeyframe).toBeNull()
  })

  it.each([
    ['objectPosition', 'position'],
    ['objectRotation', 'rotation'],
    ['objectScale', 'scale'],
  ] as const)('writes only %s when that Transform row is focused', (focus, channel) => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    useEditorStore.setState({ keyableFocus: focus, selection: `obj:${id}` })
    insertKeyframeAtPlayhead()
    const object = useSceneStore.getState().objects[0]
    expect(object.keys).toHaveLength(1)
    expect(object.keys[0].channel).toBe(channel)
    expect(object.keys[0].time).toBeCloseTo(0.4, 5)
    expect(useEditorStore.getState().selectedKeyframe).toEqual({
      kind: 'object',
      objectId: id,
      id: object.keys[0].id,
    })
  })
})
