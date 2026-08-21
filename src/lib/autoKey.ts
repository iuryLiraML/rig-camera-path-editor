import { type ObjectChannel } from './keyframes'
import { objectChannelIsAnimated } from './keyAtPlayhead'
import { requestPersistFlush } from './persistFlush'
import { useRigStore, type StaticPose } from '../state/useRigStore'
import { useSceneStore, type Transform } from '../state/useSceneStore'

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
  if (patch.position && rig.staticPosKeys.length > 0) {
    rig.upsertStaticPosKey(rig.t, next.position)
  }
  if (patch.rotation && rig.staticRotKeys.length > 0) {
    rig.upsertStaticRotKey(rig.t, next.rotation)
  }
}
