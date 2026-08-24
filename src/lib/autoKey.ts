import { evalValue, type ObjectChannel, type ValueKey } from './keyframes'
import { objectChannelIsAnimated } from './keyAtPlayhead'
import { requestPersistFlush } from './persistFlush'
import { CHANNEL_FIELD, useRigStore, type StaticPose } from '../state/useRigStore'
import { useSceneStore, type Transform, type Vec3 } from '../state/useSceneStore'
import { evalSeparatedVec3, VEC3_AXIS_CHANNELS, type Vec3GroupId } from './vec3Axes'

/** Free-camera pose at the playhead — authoring must start from this, not rest. */
export function evaluatedStaticPose(rig = useRigStore.getState()): StaticPose {
  return {
    position: evalSeparatedVec3(
      rig.t,
      rig.staticPosXKeys,
      rig.staticPosYKeys,
      rig.staticPosZKeys,
      rig.staticPose.position,
      rig.ease,
    ),
    rotation: evalSeparatedVec3(
      rig.t,
      rig.staticRotXKeys,
      rig.staticRotYKeys,
      rig.staticRotZKeys,
      rig.staticPose.rotation,
      rig.ease,
    ),
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

function keyAnimatedAxes(
  group: Vec3GroupId,
  value: Vec3,
  rig: ReturnType<typeof useRigStore.getState>,
): boolean {
  const channels = VEC3_AXIS_CHANNELS[group]
  let wrote = false
  for (let i = 0; i < 3; i++) {
    const keys = rig[CHANNEL_FIELD[channels[i]]] as ValueKey[]
    if (keys.length === 0) continue
    rig.upsertChannelKey(channels[i], rig.t, value[i])
    wrote = true
  }
  return wrote
}

function setVec3GroupRest(group: Vec3GroupId, value: Vec3) {
  const rig = useRigStore.getState()
  switch (group) {
    case 'staticPos':
      rig.setStaticPose({ position: value })
      return
    case 'staticRot':
      rig.setStaticPose({ rotation: value })
      return
    case 'lookOffset':
      rig.setLookOffset(value)
      return
    case 'target':
      rig.setTarget(value)
      return
    default: {
      const _never: never = group
      return _never
    }
  }
}

/** Rest always updates. Keys write only on axes that already have a track. */
export function writeVec3Group(group: Vec3GroupId, value: Vec3, opts: { key?: boolean } = {}) {
  setVec3GroupRest(group, value)
  if (opts.key === false) return
  if (keyAnimatedAxes(group, value, useRigStore.getState())) requestPersistFlush()
}

/** Inspector: change one axis without stamping keys on the other two. */
export function writeVec3Axis(group: Vec3GroupId, axis: 0 | 1 | 2, value: number) {
  const rig = useRigStore.getState()
  const current = evalSeparatedVec3(
    rig.t,
    rig[CHANNEL_FIELD[VEC3_AXIS_CHANNELS[group][0]]] as ValueKey[],
    rig[CHANNEL_FIELD[VEC3_AXIS_CHANNELS[group][1]]] as ValueKey[],
    rig[CHANNEL_FIELD[VEC3_AXIS_CHANNELS[group][2]]] as ValueKey[],
    group === 'staticPos'
      ? rig.staticPose.position
      : group === 'staticRot'
        ? rig.staticPose.rotation
        : group === 'lookOffset'
          ? rig.lookOffset
          : rig.target,
    rig.ease,
  )
  const next: Vec3 = [...current]
  next[axis] = value
  setVec3GroupRest(group, next)
  const channel = VEC3_AXIS_CHANNELS[group][axis]
  if ((rig[CHANNEL_FIELD[channel]] as ValueKey[]).length > 0) {
    rig.upsertChannelKey(channel, rig.t, value)
    requestPersistFlush()
  }
}

/** Rest pose always updates. Keys write when that axis is animated, unless `key: false`. */
export function writeStaticPose(patch: Partial<StaticPose>, opts: { key?: boolean } = {}) {
  const rig = useRigStore.getState()
  const next: StaticPose = {
    position: patch.position ?? rig.staticPose.position,
    rotation: patch.rotation ?? rig.staticPose.rotation,
  }
  rig.setStaticPose(patch)
  if (opts.key === false) return
  let wrote = false
  if (patch.position) wrote = keyAnimatedAxes('staticPos', next.position, rig) || wrote
  if (patch.rotation) wrote = keyAnimatedAxes('staticRot', next.rotation, rig) || wrote
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

/** Wrap degrees onto (−180, 180]. */
export function wrapRollDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 ? 180 : wrapped
}

/** Rest roll always updates; a key writes only when that channel already has a track. */
export function writeRoll(roll: number) {
  const next = wrapRollDeg(roll)
  const rig = useRigStore.getState()
  rig.setRoll(next)
  if (rig.rollKeys.length > 0) {
    rig.upsertChannelKey('roll', rig.t, next)
    requestPersistFlush()
  }
}

/** Scroll/nudge FOV from the evaluated value at the playhead, not the rest pose. */
export function nudgeFov(delta: number) {
  const rig = useRigStore.getState()
  writeFov(evalValue(rig.t, rig.fovKeys, rig.fov, rig.ease) + delta)
}

/** True once any cinema channel has a track (gizmo / panel still auto-key). */
export function cinemaAutoKeyArmed(rig = useRigStore.getState()): boolean {
  return (
    rig.fovKeys.length > 0 ||
    rig.rollKeys.length > 0 ||
    rig.progressKeys.length > 0 ||
    rig.staticPosXKeys.length > 0 ||
    rig.staticPosYKeys.length > 0 ||
    rig.staticPosZKeys.length > 0 ||
    rig.staticRotXKeys.length > 0 ||
    rig.staticRotYKeys.length > 0 ||
    rig.staticRotZKeys.length > 0 ||
    rig.targetXKeys.length > 0 ||
    rig.targetYKeys.length > 0 ||
    rig.targetZKeys.length > 0 ||
    rig.lookOffsetXKeys.length > 0 ||
    rig.lookOffsetYKeys.length > 0 ||
    rig.lookOffsetZKeys.length > 0
  )
}
