import { detachCinemaToStatic } from './addStaticCamera'
import { evaluatedStaticPose, writeStaticPose } from './autoKey'
import { hasKeyAtTime, findKeyAtTime } from './keyAtPlayhead'
import { VEC3_AXIS_CHANNELS } from './vec3Axes'
import { CHANNEL_FIELD, useRigStore } from '../state/useRigStore'
import { useEditorStore } from '../state/useEditorStore'
import { requestPersistFlush } from './persistFlush'
import { useSceneStore } from '../state/useSceneStore'
import type { ValueKey } from './keyframes'

const POSE_AXES = [...VEC3_AXIS_CHANNELS.staticPos, ...VEC3_AXIS_CHANNELS.staticRot] as const

/** Position or rotation already keyed on the playhead. */
export function poseKeyedAtPlayhead(rig = useRigStore.getState()): boolean {
  return POSE_AXES.some((channel) =>
    hasKeyAtTime(rig[CHANNEL_FIELD[channel]] as ValueKey[], rig.t),
  )
}

/**
 * Key the cinema camera's pose at the playhead. A path camera detaches first
 * so the key is a real world pose, not path progress. Look-through fly keys
 * the live rest pose; otherwise the evaluated pose at `t`.
 */
export function insertPoseKeyframeAtPlayhead(opts: { silent?: boolean } = {}) {
  detachCinemaToStatic({ stayInView: true })
  const editor = useEditorStore.getState()
  if (!editor.lookThroughLivePose) {
    writeStaticPose(evaluatedStaticPose(), { key: false })
  }
  const rig = useRigStore.getState()
  editor.select('cinema-camera')
  editor.setKeyableFocus('staticPosX')
  rig.upsertVec3GroupKey('staticPos', rig.t, rig.staticPose.position)
  rig.upsertVec3GroupKey('staticRot', rig.t, rig.staticPose.rotation)
  requestPersistFlush()
  if (!opts.silent) useSceneStore.getState().showNotice('Pose keyframe set')
}

/** Remove position + rotation keys sitting on the playhead. */
export function deletePoseKeyframeAtPlayhead(): boolean {
  const editor = useEditorStore.getState()
  const rig = useRigStore.getState()
  let removed = false
  for (const channel of POSE_AXES) {
    const keys = rig[CHANNEL_FIELD[channel]] as ValueKey[]
    const key = findKeyAtTime(keys, rig.t)
    if (!key) continue
    useRigStore.getState().removeChannelKey(channel, key.id)
    removed = true
  }
  if (removed) {
    editor.selectKeyframe(null)
    requestPersistFlush()
    useSceneStore.getState().showNotice('Pose keyframe removed')
  }
  return removed
}
