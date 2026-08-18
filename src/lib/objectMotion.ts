import * as THREE from 'three'
import { buildCurve, clamp01 } from './curve'
import { evalModelTransform, type ModelKey } from './keyframes'
import { orientationTo } from './cameraOrientation'
import type { EaseKind } from './easing'
import type { PathAnchor } from '../state/usePathStore'
import type { FollowConfig, Transform, Vec3 } from '../state/useSceneStore'

const DEG = Math.PI / 180
const RAD = 180 / Math.PI
const _tan = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _roll = new THREE.Quaternion()
const _euler = new THREE.Euler()
const LOCAL_Z = new THREE.Vector3(0, 0, 1)

export type MotionPathInput = {
  anchors: PathAnchor[]
  closed?: boolean
  rounding?: number
}

export type ObjectMotion = {
  transform: Transform
  keys: ModelKey[]
  follow?: FollowConfig
}

export type TrackTarget = {
  object: ObjectMotion
  path: MotionPathInput | null
}

/** World TRS of an object at t — same rules as SceneObjects (follow > keys > pose). */
export function evalObjectWorldTransform(
  t: number,
  object: ObjectMotion,
  path: MotionPathInput | null | undefined,
  ease: EaseKind,
): Transform {
  const clamped = clamp01(Number.isFinite(t) ? t : 0)
  if (object.follow && path) {
    const curve = buildCurve(path.anchors, path.closed ?? false, path.rounding ?? 0.8)
    if (curve) {
      const loops = Math.max(0.01, object.follow.loops)
      let phase = clamped * loops + object.follow.offset
      phase = path.closed ? ((phase % 1) + 1) % 1 : clamp01(phase)
      const p = curve.getPointAt(phase)
      const position: Vec3 = [p.x, p.y + object.follow.height, p.z]
      let rotation = object.transform.rotation
      if (object.follow.align) {
        curve.getTangentAt(phase, _tan)
        if (_tan.lengthSq() < 1e-12) _tan.set(0, 0, -1)
        else _tan.normalize()
        // Same convention as SceneObjects: mesh +Z along the path
        orientationTo(_tan.clone().negate(), null, _quat)
        if (object.follow.bank !== 0) {
          _quat.multiply(_roll.setFromAxisAngle(LOCAL_Z, object.follow.bank * DEG))
        }
        _euler.setFromQuaternion(_quat, 'XYZ')
        rotation = [_euler.x * RAD, _euler.y * RAD, _euler.z * RAD]
      }
      return { position, rotation, scale: object.transform.scale }
    }
  }
  if (object.keys.length > 0) {
    const pose = evalModelTransform(clamped, object.keys, ease)
    if (pose) return pose
  }
  return object.transform
}

/** World position of an object at t — same rules as SceneObjects (follow > keys > pose). */
export function evalObjectWorldPosition(
  t: number,
  object: ObjectMotion,
  path: MotionPathInput | null | undefined,
  ease: EaseKind,
): Vec3 {
  return evalObjectWorldTransform(t, object, path, ease).position
}

export function resolveTrackTarget(
  targetObjectId: string | null | undefined,
  objects: Array<{ id: string } & ObjectMotion>,
  paths: Array<{ id: string; anchors: PathAnchor[]; closed: boolean; rounding: number }>,
): TrackTarget | null {
  if (!targetObjectId) return null
  const object = objects.find((item) => item.id === targetObjectId)
  if (!object) return null
  const followPath = object.follow
    ? paths.find((path) => path.id === object.follow!.pathId)
    : undefined
  return {
    object: {
      transform: object.transform,
      keys: object.keys,
      follow: object.follow,
    },
    path: followPath
      ? {
          anchors: followPath.anchors,
          closed: followPath.closed,
          rounding: followPath.rounding,
        }
      : null,
  }
}
