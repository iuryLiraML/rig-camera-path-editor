import * as THREE from 'three'
import { buildCurve, clamp01 } from './curve'
import { orientationTo } from './cameraOrientation'
import { evalProgress, evalValue, type ProgressKey, type ValueKey, type Vec3Key } from './keyframes'
import { evalCinemaVec3 } from './vec3Axes'
import type { EaseKind } from './easing'
import type { PathAnchor } from '../state/usePathStore'
import type { Vec3 } from '../state/useSceneStore'
import {
  applyCameraNoise,
  normalizeCameraNoise,
  resolveCameraNoiseAt,
  type CameraNoise,
} from './cameraNoise'
import { evalObjectWorldTransform, type TrackTarget } from './objectMotion'
import { localDirToWorld, localPointToWorld } from './pathSpace'

/** Same framing modes as the R3F cinema camera (`useRigStore.lookAtMode`). */
export type LookAtMode = 'target' | 'path-tangent' | 'free'

/** Path geometry inputs for cinema evaluation (mirrors MotionPath fields). */
export type CinemaPathInput = {
  anchors: PathAnchor[]
  closed?: boolean
  rounding?: number
}

/** Animatable lens / framing channels + static fallbacks. */
export type CinemaChannels = {
  progressKeys?: ProgressKey[]
  fovKeys?: ValueKey[]
  rollKeys?: ValueKey[]
  intensityKeys?: ValueKey[]
  fadeInKeys?: ValueKey[]
  fadeOutKeys?: ValueKey[]
  ampPosKeys?: ValueKey[]
  ampRotKeys?: ValueKey[]
  freqKeys?: ValueKey[]
  targetKeys?: Vec3Key[]
  targetXKeys?: ValueKey[]
  targetYKeys?: ValueKey[]
  targetZKeys?: ValueKey[]
  lookOffset?: Vec3
  lookOffsetKeys?: Vec3Key[]
  lookOffsetXKeys?: ValueKey[]
  lookOffsetYKeys?: ValueKey[]
  lookOffsetZKeys?: ValueKey[]
  staticPosKeys?: Vec3Key[]
  staticRotKeys?: Vec3Key[]
  staticPosXKeys?: ValueKey[]
  staticPosYKeys?: ValueKey[]
  staticPosZKeys?: ValueKey[]
  staticRotXKeys?: ValueKey[]
  staticRotYKeys?: ValueKey[]
  staticRotZKeys?: ValueKey[]
  fov: number
  roll: number
  target: Vec3
  ease: EaseKind
  lookAtMode: LookAtMode
  noise?: CameraNoise
  /** Shot length in seconds — used to convert noise fade-in/out */
  duration?: number
  /** When set, look-at Target follows this object's f(t) pose instead of XYZ keys */
  track?: TrackTarget | null
  /** When set, path anchors are in this object's local space (relative camera) */
  pathParent?: TrackTarget | null
  /** `static` = manually-posed pathless camera (uses `staticPose`) */
  cameraKind?: 'path' | 'static'
  /** Pose of a static camera; rotation is XYZ Euler degrees (YXZ order) */
  staticPose?: { position: Vec3; rotation: Vec3 }
}

export type CinemaPose = {
  position: Vec3
  /** World quaternion (x, y, z, w) — camera looks down local −Z */
  quaternion: [number, number, number, number]
  fov: number
  lookTarget: Vec3
  /** Unit path tangent at eased progress (secondary for pole handover) */
  tangent: Vec3
  /** Eased path parameter after progress channel */
  pathU: number
}

const _pos = new THREE.Vector3()
const _tan = new THREE.Vector3()
const _look = new THREE.Vector3()
const _view = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _roll = new THREE.Quaternion()
const _euler = new THREE.Euler()
const _fwd = new THREE.Vector3()
const LOCAL_Z = new THREE.Vector3(0, 0, 1)
const FWD = new THREE.Vector3(0, 0, -1)

/** Applies camera-shake noise on top of a base pose, if any is configured. */
function applyNoiseToPose(pose: CinemaPose, t: number, channels: CinemaChannels): CinemaPose {
  if (!channels.noise) return pose
  const noise = resolveCameraNoiseAt(
    t,
    normalizeCameraNoise(channels.noise),
    {
      intensityKeys: channels.intensityKeys,
      fadeInKeys: channels.fadeInKeys,
      fadeOutKeys: channels.fadeOutKeys,
      ampPosKeys: channels.ampPosKeys,
      ampRotKeys: channels.ampRotKeys,
      freqKeys: channels.freqKeys,
    },
    channels.ease,
  )
  return applyCameraNoise(pose, t, noise, channels.duration ?? 6)
}

/** Look-at point for the Target mode (fixed/keyed XYZ or tracked object). */
function resolveLookTarget(t: number, channels: CinemaChannels, out: THREE.Vector3): void {
  if (channels.track) {
    const parent = evalObjectWorldTransform(t, channels.track.object, channels.track.path, channels.ease)
    const offset = evalCinemaVec3(
      t,
      { x: channels.lookOffsetXKeys, y: channels.lookOffsetYKeys, z: channels.lookOffsetZKeys },
      channels.lookOffsetKeys,
      channels.lookOffset ?? [0, 0, 0],
      channels.ease,
    )
    out.set(...localPointToWorld(offset, parent))
  } else {
    out.set(
      ...evalCinemaVec3(
        t,
        { x: channels.targetXKeys, y: channels.targetYKeys, z: channels.targetZKeys },
        channels.targetKeys,
        channels.target,
        channels.ease,
      ),
    )
  }
}

/** Pose of a manually-posed, pathless camera — position/rotation are f(t) when keyed. */
function evaluateStaticPose(t: number, channels: CinemaChannels): CinemaPose {
  const sp = channels.staticPose ?? { position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 }
  const position = evalCinemaVec3(
    t,
    { x: channels.staticPosXKeys, y: channels.staticPosYKeys, z: channels.staticPosZKeys },
    channels.staticPosKeys,
    sp.position,
    channels.ease,
  )
  const rotation = evalCinemaVec3(
    t,
    { x: channels.staticRotXKeys, y: channels.staticRotYKeys, z: channels.staticRotZKeys },
    channels.staticRotKeys,
    sp.rotation,
    channels.ease,
  )
  _pos.set(...position)
  const fov = evalValue(t, channels.fovKeys ?? [], channels.fov, channels.ease)
  const rollDeg = evalValue(t, channels.rollKeys ?? [], channels.roll, channels.ease)

  if (channels.lookAtMode === 'target') {
    resolveLookTarget(t, channels, _look)
    _view.subVectors(_look, _pos)
    _tan.set(0, 0, -1)
    orientationTo(_view, _tan, _quat)
  } else {
    _euler.set(
      rotation[0] * THREE.MathUtils.DEG2RAD,
      rotation[1] * THREE.MathUtils.DEG2RAD,
      rotation[2] * THREE.MathUtils.DEG2RAD,
      'YXZ',
    )
    _quat.setFromEuler(_euler)
    _fwd.copy(FWD).applyQuaternion(_quat)
    _look.copy(_pos).add(_fwd)
  }
  if (rollDeg !== 0) {
    _quat.multiply(_roll.setFromAxisAngle(LOCAL_Z, rollDeg * THREE.MathUtils.DEG2RAD))
  }
  const pose: CinemaPose = {
    position: [_pos.x, _pos.y, _pos.z],
    quaternion: [_quat.x, _quat.y, _quat.z, _quat.w],
    fov,
    lookTarget: [_look.x, _look.y, _look.z],
    tangent: [0, 0, -1],
    pathU: 0,
  }
  return applyNoiseToPose(pose, t, channels)
}

/**
 * Pure cinema pose f(t) — same composition as `CinemaCamera` useFrame:
 * progress keys → path sample → FOV/roll/target channels → orientationTo (+ roll).
 * Returns null when the path has fewer than two anchors (no curve).
 */
export function evaluateCinemaPose(
  t: number,
  path: CinemaPathInput,
  channels: CinemaChannels,
): CinemaPose | null {
  const clampedT = clamp01(Number.isFinite(t) ? t : 0)
  if (channels.cameraKind === 'static') return evaluateStaticPose(clampedT, channels)

  const curve = buildCurve(path.anchors, path.closed ?? false, path.rounding ?? 0.8)
  if (!curve) return null

  const eased = clamp01(
    evalProgress(clampedT, channels.progressKeys ?? [], channels.ease),
  )

  curve.getPointAt(eased, _pos)
  curve.getTangentAt(eased, _tan)
  if (_tan.lengthSq() < 1e-12) _tan.set(0, 0, -1)
  else _tan.normalize()

  if (channels.pathParent) {
    const parent = evalObjectWorldTransform(
      clampedT,
      channels.pathParent.object,
      channels.pathParent.path,
      channels.ease,
    )
    const worldPos = localPointToWorld([_pos.x, _pos.y, _pos.z], parent)
    const worldTan = localDirToWorld([_tan.x, _tan.y, _tan.z], parent)
    _pos.set(...worldPos)
    _tan.set(...worldTan)
    if (_tan.lengthSq() < 1e-12) _tan.set(0, 0, -1)
    else _tan.normalize()
  }

  const fov = evalValue(clampedT, channels.fovKeys ?? [], channels.fov, channels.ease)
  const rollDeg = evalValue(clampedT, channels.rollKeys ?? [], channels.roll, channels.ease)

  switch (channels.lookAtMode) {
    case 'target':
      resolveLookTarget(clampedT, channels, _look)
      break
    case 'path-tangent':
    case 'free':
      // a path camera has no authored orientation, so 'free' rides the tangent
      _look.copy(_pos).add(_tan)
      break
    default: {
      const _never: never = channels.lookAtMode
      return _never
    }
  }

  _view.subVectors(_look, _pos)
  orientationTo(_view, _tan, _quat)
  if (rollDeg !== 0) {
    _quat.multiply(_roll.setFromAxisAngle(LOCAL_Z, rollDeg * THREE.MathUtils.DEG2RAD))
  }

  const pose: CinemaPose = {
    position: [_pos.x, _pos.y, _pos.z],
    quaternion: [_quat.x, _quat.y, _quat.z, _quat.w],
    fov,
    lookTarget: [_look.x, _look.y, _look.z],
    tangent: [_tan.x, _tan.y, _tan.z],
    pathU: eased,
  }
  return applyNoiseToPose(pose, clampedT, channels)
}
