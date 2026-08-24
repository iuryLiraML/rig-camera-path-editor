import { afterEach, describe, expect, it } from 'vitest'
import { KEY_MERGE_EPS } from './keyframes'
import { shouldSampleFlyKey, startFlyRecord, stopFlyRecord } from './flyRecord'
import { emptyVec3AxisKeyState } from './vec3Axes'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'

afterEach(() => {
  useEditorStore.setState({
    cameraView: true,
    flyRecording: false,
    lookThroughLivePose: false,
    selection: null,
  })
  useRigStore.setState({
    cameraKind: 'static',
    lookAtMode: 'free',
    playing: false,
    t: 0,
    ...emptyVec3AxisKeyState(),
    staticPose: { position: [0, 1.6, 4], rotation: [0, 0, 0] },
  })
})

describe('flyRecord', () => {
  it('starts a drone take from the current pose and arms live fly', () => {
    useRigStore.setState({
      cameraKind: 'static',
      lookAtMode: 'target',
      t: 0.2,
      playing: true,
      staticPose: { position: [2, 1, 3], rotation: [0, 15, 0] },
    })
    useEditorStore.setState({ cameraView: true })
    startFlyRecord()
    const rig = useRigStore.getState()
    const editor = useEditorStore.getState()
    expect(editor.flyRecording).toBe(true)
    expect(editor.lookThroughLivePose).toBe(true)
    expect(rig.lookAtMode).toBe('free')
    expect(rig.playing).toBe(false)
    expect(rig.staticPosXKeys.length).toBeGreaterThan(0)
    expect(rig.staticPosXKeys[0].time).toBeCloseTo(0.2)
    expect(rig.staticPosXKeys[0].value).toBe(2)
    expect(rig.staticPosYKeys[0].value).toBe(1)
    expect(rig.staticPosZKeys[0].value).toBe(3)
  })

  it('stop keys the playhead and leaves look-through armed', () => {
    useEditorStore.setState({ cameraView: true, flyRecording: true, lookThroughLivePose: true })
    useRigStore.setState({
      cameraKind: 'static',
      t: 0.6,
      staticPose: { position: [4, 2, 1], rotation: [0, 0, 0] },
    })
    stopFlyRecord()
    expect(useEditorStore.getState().flyRecording).toBe(false)
    expect(useEditorStore.getState().lookThroughLivePose).toBe(true)
    expect(useRigStore.getState().staticPosXKeys.some((k) => Math.abs(k.time - 0.6) < 0.02)).toBe(
      true,
    )
  })

  it('does nothing when a take is not running', () => {
    useEditorStore.setState({ flyRecording: false })
    stopFlyRecord()
    expect(useRigStore.getState().staticPosXKeys).toHaveLength(0)
  })

  it('samples pose keys on a coarser-than-merge grid', () => {
    expect(shouldSampleFlyKey(0, null)).toBe(true)
    expect(shouldSampleFlyKey(KEY_MERGE_EPS, 0)).toBe(true)
    expect(shouldSampleFlyKey(KEY_MERGE_EPS * 0.5, 0)).toBe(false)
  })
})
