import { afterEach, describe, expect, it } from 'vitest'
import {
  deletePoseKeyframeAtPlayhead,
  insertPoseKeyframeAtPlayhead,
  poseKeyedAtPlayhead,
} from './poseKeyframe'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'

afterEach(() => {
  useEditorStore.setState({
    cameraView: false,
    selection: null,
    keyableFocus: null,
    selectedKeyframe: null,
  })
  useRigStore.setState({
    cameraKind: 'path',
    lookAtMode: 'target',
    t: 0,
    staticPosKeys: [],
    staticRotKeys: [],
    staticPose: { position: [0, 1.6, 4], rotation: [0, 0, 0] },
  })
})

describe('poseKeyframe', () => {
  it('detaches a path camera and keys pose at the playhead without leaving look-through', () => {
    useRigStore.setState({ cameraKind: 'path', t: 0.4, lookAtMode: 'path-tangent' })
    useEditorStore.setState({ cameraView: true, selection: 'cinema-camera' })
    insertPoseKeyframeAtPlayhead()
    const rig = useRigStore.getState()
    expect(rig.cameraKind).toBe('static')
    expect(rig.lookAtMode).toBe('free')
    expect(rig.staticPosKeys).toHaveLength(1)
    expect(rig.staticRotKeys).toHaveLength(1)
    expect(rig.staticPosKeys[0].time).toBeCloseTo(0.4)
    expect(poseKeyedAtPlayhead()).toBe(true)
    expect(useEditorStore.getState().cameraView).toBe(true)
    expect(useEditorStore.getState().keyableFocus).toBe('staticPos')
  })

  it('removes the pose keys sitting on the playhead', () => {
    useRigStore.setState({ cameraKind: 'static', t: 0.2 })
    useEditorStore.setState({ cameraView: true, selection: 'cinema-camera' })
    insertPoseKeyframeAtPlayhead()
    expect(deletePoseKeyframeAtPlayhead()).toBe(true)
    expect(useRigStore.getState().staticPosKeys).toHaveLength(0)
    expect(useRigStore.getState().staticRotKeys).toHaveLength(0)
    expect(poseKeyedAtPlayhead()).toBe(false)
  })

  it('does nothing when the playhead has no pose key', () => {
    useRigStore.setState({ cameraKind: 'static', t: 0.5, staticPosKeys: [], staticRotKeys: [] })
    expect(deletePoseKeyframeAtPlayhead()).toBe(false)
  })
})
