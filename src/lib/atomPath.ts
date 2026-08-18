import { projectedFillPercent, type Aabb } from './agent/framing'
import { fillRangeForScale, minRadiusFactor, type ShotAngle, type ShotScale } from './agent/shotTypes'
import type { Vec3 } from '../state/useSceneStore'

export type AtomKind = 'orbit' | 'arc' | 'flyover' | 'dolly' | 'crane' | 'pan' | 'tilt' | 'zoom'

export type AtomLookKey = { time: number; target: Vec3 }
export type AtomFovKey = { time: number; fov: number }

export interface AtomPath {
  kind: AtomKind
  anchors: Vec3[]
  closed: boolean
  lookTarget: Vec3
  lookKeys: AtomLookKey[]
  fov: number
  fovKeys: AtomFovKey[]
  roll: number
  radius: number
}

export function fovForScale(scale: ShotScale): number {
  switch (scale) {
    case 'ecu':
      return 32
    case 'cu':
      return 38
    case 'mcu':
      return 42
    case 'ms':
      return 45
    case 'ls':
      return 50
    case 'els':
      return 55
    case 'auto':
      return 45
    default: {
      const _never: never = scale
      return _never
    }
  }
}

export function targetFillPercent(scale: ShotScale): number {
  const { min, max } = fillRangeForScale(scale)
  return (min + max) / 2
}

/** Pitch of the camera above the subject, in degrees (negative = low angle). */
export function pitchForAngle(angle: ShotAngle): number {
  switch (angle) {
    case 'eye':
    case 'dutch':
      return 8
    case 'low':
      return -22
    case 'high':
      return 28
    case 'top':
      return 78
    default: {
      const _never: never = angle
      return _never
    }
  }
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(...v) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

/** Horizontal 3/4 bearing used as the hero side of every atom. */
const BEARING: Vec3 = normalize([1, 0, 0.85])

export function cameraOffset(radius: number, angle: ShotAngle, yaw = 0): Vec3 {
  const pitch = (pitchForAngle(angle) * Math.PI) / 180
  const c = Math.cos(pitch)
  const s = Math.sin(pitch)
  const x = Math.cos(yaw) * BEARING[0] - Math.sin(yaw) * BEARING[2]
  const z = Math.sin(yaw) * BEARING[0] + Math.cos(yaw) * BEARING[2]
  return [x * radius * c, radius * s, z * radius * c]
}

/**
 * Distance along the angled ray that lands fill % on the mid-band,
 * never closer than the judge's path_scale floor.
 */
export function distanceForFill(
  box: Aabb,
  scale: ShotScale,
  angle: ShotAngle,
  aspect: number,
  fov: number,
): number {
  const target = targetFillPercent(scale)
  const minR = minRadiusFactor(scale) * Math.max(box.diagonal, 0.2)
  let lo = Math.max(0.2, minR * 0.4)
  let hi = Math.max(8, box.diagonal * 12)
  let best = Math.max(minR, box.diagonal * 1.4)
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2
    const pos = add(box.center, cameraOffset(mid, angle))
    const fill = projectedFillPercent(box, pos, box.center, fov, aspect)
    best = mid
    if (fill > target) lo = mid
    else hi = mid
  }
  return Math.max(minR, best)
}

function ring(center: Vec3, radius: number, angle: ShotAngle, count: number, from: number, to: number): Vec3[] {
  return Array.from({ length: count }, (_, i) => {
    const yaw = from + ((to - from) * i) / Math.max(1, count - 1)
    return add(center, cameraOffset(radius, angle, yaw))
  })
}

/**
 * Parametric camera atom around a subject AABB. The LLM never invents metres —
 * radius comes from the fill-band solver.
 */
export function instantiateAtom(opts: {
  kind: AtomKind
  subject: Aabb
  scale: ShotScale
  angle: ShotAngle
  aspect?: number
}): AtomPath {
  const aspect = opts.aspect ?? 16 / 9
  const fov = fovForScale(opts.scale)
  const radius = distanceForFill(opts.subject, opts.scale, opts.angle, aspect, fov)
  const center = opts.subject.center
  const size = opts.subject.size
  const lookTarget = center
  const roll = opts.angle === 'dutch' ? 12 : 0
  const emptyKeys: AtomLookKey[] = []
  const emptyFov: AtomFovKey[] = []

  switch (opts.kind) {
    case 'orbit':
      return {
        kind: opts.kind,
        anchors: ring(center, radius, opts.angle, 8, 0, Math.PI * 2 * (7 / 8)),
        closed: true,
        lookTarget,
        lookKeys: emptyKeys,
        fov,
        fovKeys: emptyFov,
        roll,
        radius,
      }
    case 'arc':
      return {
        kind: opts.kind,
        anchors: ring(center, radius, opts.angle, 5, -0.7, 0.7),
        closed: false,
        lookTarget,
        lookKeys: emptyKeys,
        fov,
        fovKeys: emptyFov,
        roll,
        radius,
      }
    case 'dolly':
      return {
        kind: opts.kind,
        anchors: [
          add(center, cameraOffset(radius * 1.45, opts.angle)),
          add(center, cameraOffset(radius * 0.88, opts.angle)),
        ],
        closed: false,
        lookTarget,
        lookKeys: emptyKeys,
        fov,
        fovKeys: emptyFov,
        roll,
        radius,
      }
    case 'crane': {
      const far = cameraOffset(radius, 'eye')
      const high = cameraOffset(radius, opts.angle === 'low' ? 'eye' : 'high')
      return {
        kind: opts.kind,
        anchors: [add(center, [far[0], Math.max(0.15, center[1] - size[1] * 0.35), far[2]]), add(center, high)],
        closed: false,
        lookTarget,
        lookKeys: emptyKeys,
        fov,
        fovKeys: emptyFov,
        roll,
        radius,
      }
    }
    case 'flyover':
      return {
        kind: opts.kind,
        anchors: [
          add(center, cameraOffset(radius * 1.25, 'high', -2.2)),
          add(center, cameraOffset(radius * 1.05, opts.scale === 'els' || opts.scale === 'ls' ? 'top' : 'high', 0)),
          add(center, cameraOffset(radius * 1.25, 'eye', 2.2)),
        ],
        closed: false,
        lookTarget,
        lookKeys: emptyKeys,
        fov,
        fovKeys: emptyFov,
        roll,
        radius,
      }
    case 'pan': {
      const hold = add(center, cameraOffset(radius, opts.angle))
      return {
        kind: opts.kind,
        anchors: [hold, add(hold, [0.02, 0, 0])],
        closed: false,
        lookTarget,
        lookKeys: [
          { time: 0, target: [center[0] - size[0] * 0.55, center[1], center[2]] },
          { time: 1, target: [center[0] + size[0] * 0.55, center[1], center[2]] },
        ],
        fov,
        fovKeys: emptyFov,
        roll,
        radius,
      }
    }
    case 'tilt': {
      const hold = add(center, cameraOffset(radius, opts.angle === 'top' ? 'high' : opts.angle))
      return {
        kind: opts.kind,
        anchors: [hold, add(hold, [0.02, 0, 0])],
        closed: false,
        lookTarget,
        lookKeys: [
          { time: 0, target: [center[0], Math.max(0.08, center[1] - size[1] * 0.4), center[2]] },
          { time: 1, target: [center[0], center[1] + size[1] * 0.55, center[2]] },
        ],
        fov,
        fovKeys: emptyFov,
        roll,
        radius,
      }
    }
    case 'zoom': {
      const hold = add(center, cameraOffset(radius, opts.angle))
      return {
        kind: opts.kind,
        anchors: [hold, add(hold, [0.02, 0, 0])],
        closed: false,
        lookTarget,
        lookKeys: emptyKeys,
        fov,
        fovKeys: [
          { time: 0, fov: Math.min(75, fov + 18) },
          { time: 1, fov: Math.max(24, fov - 10) },
        ],
        roll,
        radius,
      }
    }
    default: {
      const _never: never = opts.kind
      return _never
    }
  }
}
