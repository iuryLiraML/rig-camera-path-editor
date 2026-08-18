import * as THREE from 'three'
import { meshWorldBounds } from './prepareImport'
import { worldPointToLocal } from './pathSpace'
import type { Transform, Vec3 } from '../state/useSceneStore'

export const ZERO_LOOK_OFFSET: Vec3 = [0, 0, 0]

/** Center of the object's mesh AABB, in the object's local (transform) space. */
export function localAabbCenter(root: THREE.Object3D, transform: Transform): Vec3 {
  const box = meshWorldBounds(root)
  if (box.isEmpty()) return [...ZERO_LOOK_OFFSET]
  const world = box.getCenter(new THREE.Vector3())
  return worldPointToLocal([world.x, world.y, world.z], transform)
}
