import { beforeEach, describe, expect, it } from 'vitest'
import { animateMenuItems, animateProperty } from './animateProperty'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'

beforeEach(() => {
  useEditorStore.setState({
    selection: null,
    keyableFocus: null,
    selectedKeyframe: null,
  })
  useSceneStore.setState({ objects: [], pendingLifts: [] })
  useRigStore.setState({
    t: 0.4,
    cameraKind: 'path',
    staticPose: { position: [4, 2, 6], rotation: [0, 10, 0] },
    staticPosKeys: [],
    staticRotKeys: [],
    fovKeys: [],
    rollKeys: [],
  })
})

describe('animateMenuItems', () => {
  it('lists Position / Rotation / Scale for an object', () => {
    expect(animateMenuItems('obj:box-1', 'path').map((item) => item.label)).toEqual([
      'Position',
      'Rotation',
      'Scale',
    ])
  })

  it('lists Position / Rotation / FOV / Roll for a Free camera', () => {
    expect(animateMenuItems('cinema-camera', 'static').map((item) => item.label)).toEqual([
      'Position',
      'Rotation',
      'FOV',
      'Roll',
    ])
  })

  it('is empty for a path camera with no object selected', () => {
    expect(animateMenuItems('cinema-camera', 'path')).toEqual([])
  })
})

describe('animateProperty', () => {
  it('adds an object Position track and a key at the playhead', () => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    useEditorStore.setState({ selection: `obj:${id}` })
    animateProperty({ kind: 'object', channel: 'position', label: 'Position' })
    const object = useSceneStore.getState().objects[0]
    expect(object.keys).toHaveLength(1)
    expect(object.keys[0].channel).toBe('position')
    expect(object.keys[0].time).toBeCloseTo(0.4, 5)
    expect(useEditorStore.getState().keyableFocus).toBe('objectPosition')
  })

  it('adds a Free-camera Position key at the playhead', () => {
    useRigStore.setState({ cameraKind: 'static' })
    useEditorStore.setState({ selection: 'cinema-camera' })
    animateProperty({ kind: 'rig', channel: 'staticPos', label: 'Position' })
    const keys = useRigStore.getState().staticPosKeys
    expect(keys).toHaveLength(1)
    expect(keys[0].time).toBeCloseTo(0.4, 5)
    expect(keys[0].value).toEqual([4, 2, 6])
    expect(useEditorStore.getState().keyableFocus).toBe('staticPos')
  })
})
