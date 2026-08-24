import { afterEach, describe, expect, it } from 'vitest'
import {
  deletePoseKeyframeAtPlayhead,
  insertPoseKeyframeAtPlayhead,
  poseKeyedAtPlayhead,
} from './poseKeyframe'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { emptyVec3AxisKeyState } from './vec3Axes'

afterEach(() => {
  useEditorStore.setState({
    cameraView: false,
    selection: null,
    keyableFocus: null,
    selectedKeyframe: null,
    lookThroughLivePose: false,
    flyRecording: false,
  })
  useRigStore.setState({
    cameraKind: 'path',
    lookAtMode: 'target',
    t: 0,
    staticPose: { position: [0, 1.6, 4], rotation: [0, 0, 0] },
    ...emptyVec3AxisKeyState(),
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
    expect(rig.staticPosXKeys).toHaveLength(1)
    expect(rig.staticRotXKeys).toHaveLength(1)
    expect(rig.staticPosXKeys[0].time).toBeCloseTo(0.4)
    expect(poseKeyedAtPlayhead()).toBe(true)
    expect(useEditorStore.getState().cameraView).toBe(true)
    expect(useEditorStore.getState().keyableFocus).toBe('staticPosX')
  })

  it('keys the live rest pose, not the interpolated track', () => {
    useRigStore.setState({
      cameraKind: 'static',
      t: 0.5,
      ease: 'linear',
      staticPose: { position: [9, 2, 3], rotation: [0, 12, 0] },
      staticPosXKeys: [
        { id: 'a', time: 0, value: 0 },
        { id: 'b', time: 1, value: 10 },
      ],
      staticPosYKeys: [
        { id: 'ay', time: 0, value: 0 },
        { id: 'by', time: 1, value: 0 },
      ],
      staticPosZKeys: [
        { id: 'az', time: 0, value: 0 },
        { id: 'bz', time: 1, value: 0 },
      ],
      staticRotXKeys: [{ id: 'cx', time: 0, value: 0 }],
      staticRotYKeys: [{ id: 'c', time: 0, value: 0 }],
      staticRotZKeys: [{ id: 'cz', time: 0, value: 0 }],
    })
    useEditorStore.setState({ cameraView: true, lookThroughLivePose: true })
    insertPoseKeyframeAtPlayhead()
    const pos = useRigStore.getState().staticPosXKeys.find((k) => Math.abs(k.time - 0.5) < 0.02)
    expect(pos?.value).toBeCloseTo(9)
  })

  it('removes the pose keys sitting on the playhead', () => {
    useRigStore.setState({ cameraKind: 'static', t: 0.2 })
    useEditorStore.setState({ cameraView: true, selection: 'cinema-camera' })
    insertPoseKeyframeAtPlayhead()
    expect(deletePoseKeyframeAtPlayhead()).toBe(true)
    expect(useRigStore.getState().staticPosXKeys).toHaveLength(0)
    expect(useRigStore.getState().staticRotXKeys).toHaveLength(0)
    expect(poseKeyedAtPlayhead()).toBe(false)
  })

  it('does nothing when the playhead has no pose key', () => {
    useRigStore.setState({ cameraKind: 'static', t: 0.5, ...emptyVec3AxisKeyState() })
    expect(deletePoseKeyframeAtPlayhead()).toBe(false)
  })
})
