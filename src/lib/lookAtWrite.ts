import { evalObjectWorldTransform, resolveTrackTarget } from './objectMotion'
import { worldPointToLocal } from './pathSpace'
import { usePathStore } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore, type Vec3 } from '../state/useSceneStore'

/** Write a world-space look-at point into the keyed target or a tracked offset. */
export function writeLookAt(world: Vec3) {
  const rig = useRigStore.getState()
  const t = rig.t
  const scene = {
    objects: useSceneStore.getState().objects,
    paths: usePathStore.getState().paths,
  }
  const track = resolveTrackTarget(rig.targetObjectId, scene.objects, scene.paths)
  if (track) {
    const parent = evalObjectWorldTransform(t, track.object, track.path, rig.ease)
    const offset = worldPointToLocal(world, parent)
    if (rig.lookOffsetKeys.length > 0) rig.upsertLookOffsetKey(t, offset)
    else rig.setLookOffset(offset)
    return
  }
  if (rig.targetKeys.length > 0) rig.upsertTargetKey(t, world)
  else rig.setTarget(world)
}
