import { detachCinemaToStatic } from './addStaticCamera'
import { hasKeyAtTime, findKeyAtTime } from './keyAtPlayhead'
import { insertChannelKeyAt } from './timelineKey'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { requestPersistFlush } from './persistFlush'
import { useSceneStore } from '../state/useSceneStore'

const POSE_CHANNELS = ['staticPos', 'staticRot'] as const

/** Position or rotation already keyed on the playhead. */
export function poseKeyedAtPlayhead(rig = useRigStore.getState()): boolean {
  return (
    hasKeyAtTime(rig.staticPosKeys, rig.t) || hasKeyAtTime(rig.staticRotKeys, rig.t)
  )
}

/**
 * Key the cinema camera's pose at the playhead. A path camera detaches first
 * so the key is a real world pose, not path progress.
 */
export function insertPoseKeyframeAtPlayhead() {
  detachCinemaToStatic({ stayInView: true })
  const editor = useEditorStore.getState()
  const rig = useRigStore.getState()
  editor.select('cinema-camera')
  editor.setKeyableFocus('staticPos')
  for (const channel of POSE_CHANNELS) insertChannelKeyAt(channel, rig.t)
  useSceneStore.getState().showNotice('Pose keyframe set')
}

/** Remove position + rotation keys sitting on the playhead. */
export function deletePoseKeyframeAtPlayhead(): boolean {
  const editor = useEditorStore.getState()
  const rig = useRigStore.getState()
  let removed = false
  for (const channel of POSE_CHANNELS) {
    const keys = channel === 'staticPos' ? rig.staticPosKeys : rig.staticRotKeys
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
