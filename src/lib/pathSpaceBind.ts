import type { Object3D } from 'three'
import { cameraPath } from '../state/cameraPathLink'
import { usePathStore, type PathAnchor } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'
import type { Transform, Vec3 } from '../state/useSceneStore'
import {
  evalObjectWorldTransform,
  resolveTrackTarget,
  type ObjectMotion,
} from './objectMotion'
import { localAabbCenter, ZERO_LOOK_OFFSET } from './lookAtOffset'
import { bakeAnchorsToSpace, worldDirToLocal, worldPointToLocal, type PathSpace } from './pathSpace'

export type PathSpaceScene = {
  objects: Array<{ id: string; root?: Object3D } & ObjectMotion>
  paths: Array<{ id: string; anchors: PathAnchor[]; closed: boolean; rounding: number }>
}

function parentAt(objectId: string, scene: PathSpaceScene): Transform | null {
  const rig = useRigStore.getState()
  const track = resolveTrackTarget(objectId, scene.objects, scene.paths)
  if (!track) return null
  return evalObjectWorldTransform(rig.t, track.object, track.path, rig.ease)
}

function bakeLive(parent: Transform, direction: 'worldToLocal' | 'localToWorld') {
  const path = cameraPath()
  if (!path || path.anchors.length === 0) return
  usePathStore.getState().setPathData(path.id, {
    anchors: bakeAnchorsToSpace(path.anchors, parent, direction),
  })
}

/** Toggle World ↔ Object and bake the live camera path so the ribbon does not jump. */
export function setCameraPathSpace(space: PathSpace, scene: PathSpaceScene) {
  const rig = useRigStore.getState()
  if (space === rig.pathSpace) return
  if (space === 'object' && !rig.targetObjectId) return
  const parentId = rig.targetObjectId
  if (parentId) {
    const parent = parentAt(parentId, scene)
    if (parent) bakeLive(parent, space === 'object' ? 'worldToLocal' : 'localToWorld')
  }
  useRigStore.getState().setPathSpace(space)
}

/** Change the tracked object; rebake if the path is currently in object space. */
export function setTrackObjectId(id: string | null, scene: PathSpaceScene) {
  const rig = useRigStore.getState()
  const prev = rig.targetObjectId
  if (id === prev) return

  if (rig.pathSpace === 'object' && prev && prev !== id) {
    const oldParent = parentAt(prev, scene)
    if (oldParent) bakeLive(oldParent, 'localToWorld')
    useRigStore.getState().setPathSpace('world')
    useRigStore.getState().setTargetObjectId(id)
    applyLookOffsetForTrack(id, scene)
    if (id) {
      const next = parentAt(id, scene)
      if (next) {
        bakeLive(next, 'worldToLocal')
        useRigStore.getState().setPathSpace('object')
      }
    }
    return
  }
  useRigStore.getState().setTargetObjectId(id)
  applyLookOffsetForTrack(id, scene)
}

function applyLookOffsetForTrack(id: string | null, scene: PathSpaceScene) {
  const rig = useRigStore.getState()
  if (!id) {
    rig.setLookOffset([...ZERO_LOOK_OFFSET] as Vec3)
    rig.clearChannel('lookOffset')
    return
  }
  const object = scene.objects.find((item) => item.id === id)
  const parent = parentAt(id, scene)
  const offset =
    object?.root && parent
      ? localAabbCenter(object.root, parent)
      : ([...ZERO_LOOK_OFFSET] as Vec3)
  rig.setLookOffset(offset)
  rig.clearChannel('lookOffset')
}

/** Bake object-space path back to world before the parent is removed. */
export function releasePathParent(objectId: string, scene: PathSpaceScene) {
  const rig = useRigStore.getState()
  if (rig.pathSpace !== 'object' || rig.targetObjectId !== objectId) return
  const parent = parentAt(objectId, scene)
  if (parent) bakeLive(parent, 'localToWorld')
  useRigStore.getState().setPathSpace('world')
}

/** Parent TRS for the path being edited, or null when the path is world-space. */
export function currentPathParentTransform(activePathId: string, scene: PathSpaceScene): Transform | null {
  const rig = useRigStore.getState()
  if (rig.pathSpace !== 'object' || !rig.targetObjectId) return null
  const followed = cameraPath()
  if (!followed || activePathId !== followed.id) return null
  return parentAt(rig.targetObjectId, scene)
}

export function worldHitToPathLocal(world: Vec3, activePathId: string, scene: PathSpaceScene): Vec3 {
  const parent = currentPathParentTransform(activePathId, scene)
  return parent ? worldPointToLocal(world, parent) : world
}

export function worldDirToPathLocal(world: Vec3, activePathId: string, scene: PathSpaceScene): Vec3 {
  const parent = currentPathParentTransform(activePathId, scene)
  return parent ? worldDirToLocal(world, parent) : world
}
