import { beforeEach, describe, expect, it } from 'vitest'
import { deleteSelectedTimelineKey, insertChannelKeyAt } from './timelineKey'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'

beforeEach(() => {
  useEditorStore.setState({ selectedKeyframe: null, selection: 'cinema-camera' })
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
