import { evalValue, evalVec3, type ObjectChannel } from './keyframes'
import { objectChannelIsAnimated } from './keyAtPlayhead'
import { requestPersistFlush } from './persistFlush'
import { useRigStore, type StaticPose } from '../state/useRigStore'
import { useSceneStore, type Transform } from '../state/useSceneStore'

/** Free-camera pose at the playhead — authoring must start from this, not rest. */
export function evaluatedStaticPose(rig = useRigStore.getState()): StaticPose {
  return {
    position: evalVec3(rig.t, rig.staticPosKeys, rig.staticPose.position, rig.ease),
    rotation: evalVec3(rig.t, rig.staticRotKeys, rig.staticPose.rotation, rig.ease),
  }
}

/** Once a transform channel has a track, later viewport/panel edits key the playhead. */
export function autoKeyObjectChannels(objectId: string, channels: ObjectChannel[]) {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object || channels.length === 0) return
  const t = useRigStore.getState().t
  let wrote = false
  for (const channel of channels) {
    if (objectChannelIsAnimated(object.keys, channel)) {
      useSceneStore.getState().addObjectKey(objectId, t, channel)
      wrote = true
    }
  }
  if (wrote) requestPersistFlush()
}

export function writeObjectTransform(
  objectId: string,
  transform: Transform,
  channels: ObjectChannel[],
) {
  useSceneStore.getState().setTransformAll(objectId, transform)
  autoKeyObjectChannels(objectId, channels)
}

/** Rest pose always updates; keys only write when that Free-camera channel is already animated. */
export function writeStaticPose(patch: Partial<StaticPose>) {
  const rig = useRigStore.getState()
  const next: StaticPose = {
    position: patch.position ?? rig.staticPose.position,
    rotation: patch.rotation ?? rig.staticPose.rotation,
  }
  rig.setStaticPose(patch)
  let wrote = false
  if (patch.position && rig.staticPosKeys.length > 0) {
    rig.upsertStaticPosKey(rig.t, next.position)
    wrote = true
  }
  if (patch.rotation && rig.staticRotKeys.length > 0) {
    rig.upsertStaticRotKey(rig.t, next.rotation)
    wrote = true
  }
  if (wrote) requestPersistFlush()
}

function clampFov(fov: number) {
  return Math.min(140, Math.max(5, fov))
}

/** Rest FOV always updates; a key writes only when that channel already has a track. */
export function writeFov(fov: number) {
  const next = clampFov(fov)
  const rig = useRigStore.getState()
  rig.setFov(next)
  if (rig.fovKeys.length > 0) {
    rig.upsertChannelKey('fov', rig.t, next)
    requestPersistFlush()
  }
}

/** Rest roll always updates; a key writes only when that channel already has a track. */
export function writeRoll(roll: number) {
  const rig = useRigStore.getState()
  rig.setRoll(roll)
  if (rig.rollKeys.length > 0) {
    rig.upsertChannelKey('roll', rig.t, roll)
    requestPersistFlush()
  }
}

/** Scroll/nudge FOV from the evaluated value at the playhead, not the rest pose. */
export function nudgeFov(delta: number) {
  const rig = useRigStore.getState()
  writeFov(evalValue(rig.t, rig.fovKeys, rig.fov, rig.ease) + delta)
}

/**
 * Look-through is "recording" when a camera channel already has a track —
 * later viewport/panel edits key that playhead, Cinema 4D-style.
 */
export function cinemaAutoKeyArmed(rig = useRigStore.getState()): boolean {
  return (
    rig.fovKeys.length > 0 ||
    rig.rollKeys.length > 0 ||
    rig.progressKeys.length > 0 ||
    rig.staticPosKeys.length > 0 ||
    rig.staticRotKeys.length > 0 ||
    rig.targetKeys.length > 0 ||
    rig.lookOffsetKeys.length > 0
  )
}
