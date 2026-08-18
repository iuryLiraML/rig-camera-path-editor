import * as THREE from 'three'
import type { StaticPose } from '../state/useRigStore'
import type { Vec3 } from '../state/useSceneStore'

const RAD2DEG = THREE.MathUtils.RAD2DEG
const DEG2RAD = THREE.MathUtils.DEG2RAD
const MAX_PITCH = 89 * DEG2RAD

const _q = new THREE.Quaternion()
const _e = new THREE.Euler(0, 0, 0, 'YXZ')
const _m = new THREE.Matrix4()
const _up = new THREE.Vector3(0, 1, 0)
const _eye = new THREE.Vector3()
const _tgt = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const FWD = new THREE.Vector3(0, 0, -1)
const RIGHT = new THREE.Vector3(1, 0, 0)

/** Euler degrees (YXZ) equivalent to a world quaternion. */
export function eulerDegFromQuaternion(q: THREE.Quaternion): Vec3 {
  _e.setFromQuaternion(q, 'YXZ')
  return [_e.x * RAD2DEG, _e.y * RAD2DEG, _e.z * RAD2DEG]
}

/** Static pose (position + YXZ Euler degrees) captured from a THREE camera. */
export function poseFromCamera(camera: THREE.Camera): StaticPose {
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    rotation: eulerDegFromQuaternion(camera.quaternion),
  }
}

/** Static pose captured from any object (gizmo proxy). */
export function poseFromObject(object: THREE.Object3D): StaticPose {
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: eulerDegFromQuaternion(object.quaternion),
  }
}

/** Write a static pose onto an object using the same YXZ convention as the rig. */
export function applyPoseToObject(object: THREE.Object3D, pose: StaticPose): void {
  object.position.set(...pose.position)
  _e.set(pose.rotation[0] * DEG2RAD, pose.rotation[1] * DEG2RAD, pose.rotation[2] * DEG2RAD, 'YXZ')
  object.quaternion.setFromEuler(_e)
}

/** YXZ Euler degrees that orient a camera at `position` to look at `target`. */
export function lookAtRotationDeg(position: Vec3, target: Vec3): Vec3 {
  _eye.set(...position)
  _tgt.set(...target)
  _m.lookAt(_eye, _tgt, _up)
  _q.setFromRotationMatrix(_m)
  return eulerDegFromQuaternion(_q)
}

/**
 * Place a free camera in front of the editor view so the body is visible,
 * facing the same way. Sitting on the editor camera made screen-scale collapse
 * the gizmo to a speck and looked like the cinema camera had vanished.
 */
export function posePlacedInView(camera: THREE.Camera, distance = 3): StaticPose {
  _fwd.copy(FWD).applyQuaternion(camera.quaternion)
  const position: Vec3 = [
    camera.position.x + _fwd.x * distance,
    camera.position.y + _fwd.y * distance,
    camera.position.z + _fwd.z * distance,
  ]
  const target: Vec3 = [
    position[0] + _fwd.x * 4,
    position[1] + _fwd.y * 4,
    position[2] + _fwd.z * 4,
  ]
  return { position, rotation: lookAtRotationDeg(position, target) }
}

/** World point a static pose is looking at, `distance` metres along its −Z. */
export function lookPointFromPose(pose: StaticPose, distance = 5): Vec3 {
  _e.set(pose.rotation[0] * DEG2RAD, pose.rotation[1] * DEG2RAD, pose.rotation[2] * DEG2RAD, 'YXZ')
  _q.setFromEuler(_e)
  _fwd.copy(FWD).applyQuaternion(_q)
  return [
    pose.position[0] + _fwd.x * distance,
    pose.position[1] + _fwd.y * distance,
    pose.position[2] + _fwd.z * distance,
  ]
}

export interface FlyInput {
  /** local move intents, each −1..1 */
  forward: number
  right: number
  up: number
  /** look deltas in radians (mouse) */
  yawDelta: number
  pitchDelta: number
  /** metres per second */
  speed: number
  /** seconds since last frame */
  dt: number
}

/**
 * First-person fly step: applies mouse look + WASDQE movement to a static pose.
 * Horizon stays level (roll untouched); pitch is clamped just short of ±90°.
 * Pure so it can be unit-tested away from the render loop.
 */
export function applyFly(pose: StaticPose, input: FlyInput): StaticPose {
  let yaw = pose.rotation[1] * DEG2RAD - input.yawDelta
  let pitch = pose.rotation[0] * DEG2RAD - input.pitchDelta
  pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch))
  yaw = ((yaw + Math.PI) % (2 * Math.PI)) - Math.PI

  _e.set(pitch, yaw, 0, 'YXZ')
  _q.setFromEuler(_e)
  _fwd.copy(FWD).applyQuaternion(_q)
  _right.copy(RIGHT).applyQuaternion(_q)

  const d = input.speed * input.dt
  const x = pose.position[0] + _fwd.x * input.forward * d + _right.x * input.right * d
  const y = pose.position[1] + _fwd.y * input.forward * d + _right.y * input.right * d + input.up * d
  const z = pose.position[2] + _fwd.z * input.forward * d + _right.z * input.right * d

  return { position: [x, y, z], rotation: [pitch * RAD2DEG, yaw * RAD2DEG, 0] }
}

/**
 * The PiP pass writes the cinema camera's aspect to the corner fraction.
 * Look-through and play make that camera the default view, so restore the
 * canvas aspect or the shot looks stretched.
 */
export function applyCanvasAspect(
  cam: { aspect: number; updateProjectionMatrix: () => void },
  width: number,
  height: number,
): boolean {
  const aspect = width / Math.max(1, height)
  if (Math.abs(cam.aspect - aspect) <= 1e-4) return false
  cam.aspect = aspect
  cam.updateProjectionMatrix()
  return true
}
