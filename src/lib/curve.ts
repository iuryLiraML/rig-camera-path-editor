import * as THREE from 'three'
import type { PathAnchor } from '../state/useRigStore'
import type { Vec3 } from '../state/useSceneStore'

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/** Per-point handle behavior, exposed in the pen tool. */
export type HandleType = 'auto' | 'vector' | 'aligned' | 'free'
export type TangentMode = HandleType | 'mirrored' | 'smooth' | 'corner' | 'broken'

const handleLenSq = (h: Vec3) => h[0] * h[0] + h[1] * h[1] + h[2] * h[2]

/** Classify an anchor's current handle setup into one of the named modes. */
export function anchorTangentMode(anchor: PathAnchor): TangentMode {
  if (!anchor.manual) return 'auto'
  if (anchor.handleInType || anchor.handleOutType) {
    if (anchor.mirrored) return 'mirrored'
    if (anchor.handleInType === anchor.handleOutType) return anchor.handleInType!
    return 'free'
  }
  const flat = handleLenSq(anchor.handleIn) < 1e-8 && handleLenSq(anchor.handleOut) < 1e-8
  if (flat) return 'corner'
  return anchor.mirrored ? 'smooth' : 'broken'
}

/**
 * Single-slider easing for lay users: blends linear (constant speed) into
 * smootherstep (gentle start/stop). s = 0 → linear, s = 1 → fully smooth.
 */
export function easeSmooth(t: number, s: number): number {
  const smoother = t * t * t * (t * (t * 6 - 15) + 10)
  return t + (smoother - t) * clamp01(s)
}

const v = {
  p: new THREE.Vector3(),
  prev: new THREE.Vector3(),
  next: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
}

/**
 * Resolves Bézier handles for anchors that the user hasn't touched (manual=false)
 * using Catmull-Rom style tangents scaled by the "rounding" slider (0..1).
 * rounding = 0 → straight segments; rounding = 1 → fully rounded curve.
 * Vector controls point one third of the way toward their neighbors. Other
 * manual controls keep their stored positions, including untyped legacy data.
 */
export function computeAutoHandles(
  anchors: PathAnchor[],
  closed: boolean,
  rounding: number,
): PathAnchor[] {
  const n = anchors.length
  if (n < 2) return anchors
  return anchors.map((anchor, i) => {
    const prevA = closed ? anchors[(i - 1 + n) % n] : anchors[Math.max(0, i - 1)]
    const nextA = closed ? anchors[(i + 1) % n] : anchors[Math.min(n - 1, i + 1)]
    if (anchor.manual) {
      // Old projects have no explicit types; their exact stored geometry survives.
      const vector = (neighbor: PathAnchor): Vec3 => neighbor.position.map(
        (value, axis) => (value - anchor.position[axis]) / 3,
      ) as Vec3
      return {
        ...anchor,
        handleIn: anchor.handleInType === 'vector' ? vector(prevA) : anchor.handleIn,
        handleOut: anchor.handleOutType === 'vector' ? vector(nextA) : anchor.handleOut,
      }
    }
    v.p.set(...anchor.position)
    v.prev.set(...prevA.position)
    v.next.set(...nextA.position)
    v.tangent.subVectors(v.next, v.prev)
    if (v.tangent.lengthSq() < 1e-10) {
      return { ...anchor, handleIn: [0, 0, 0] as Vec3, handleOut: [0, 0, 0] as Vec3 }
    }
    v.tangent.normalize()
    const dNext = v.p.distanceTo(v.next)
    const dPrev = v.p.distanceTo(v.prev)
    const isFirst = !closed && i === 0
    const isLast = !closed && i === n - 1
    const out = isLast
      ? ([0, 0, 0] as Vec3)
      : ([
          v.tangent.x * (dNext / 3) * rounding,
          v.tangent.y * (dNext / 3) * rounding,
          v.tangent.z * (dNext / 3) * rounding,
        ] as Vec3)
    const inn = isFirst
      ? ([0, 0, 0] as Vec3)
      : ([
          -v.tangent.x * (dPrev / 3) * rounding,
          -v.tangent.y * (dPrev / 3) * rounding,
          -v.tangent.z * (dPrev / 3) * rounding,
        ] as Vec3)
    return { ...anchor, handleOut: out, handleIn: inn }
  })
}

/**
 * Chained cubic Béziers over resolved anchors. CurvePath.getPointAt is
 * arc-length parameterized, so playback speed is constant.
 */
export function buildCurve(
  anchors: PathAnchor[],
  closed: boolean,
  rounding: number,
): THREE.CurvePath<THREE.Vector3> | null {
  if (anchors.length < 2) return null
  const resolved = computeAutoHandles(anchors, closed, rounding)
  const path = new THREE.CurvePath<THREE.Vector3>()
  const segments = closed ? resolved.length : resolved.length - 1
  for (let i = 0; i < segments; i++) {
    const a = resolved[i]
    const b = resolved[(i + 1) % resolved.length]
    const va = new THREE.Vector3(...a.position)
    const vb = new THREE.Vector3(...b.position)
    path.add(
      new THREE.CubicBezierCurve3(
        va,
        va.clone().add(new THREE.Vector3(...a.handleOut)),
        vb.clone().add(new THREE.Vector3(...b.handleIn)),
        vb,
      ),
    )
  }
  return path
}

/** Path-local distance a Ctrl+click must be within to count as a segment hit. */
export const CURVE_SEGMENT_HIT_DISTANCE = 0.4

/** Index of the closest cubic segment, or null when the point is off the curve. */
export function nearestSegmentHit(
  curve: THREE.CurvePath<THREE.Vector3>,
  point: THREE.Vector3,
  maxDistance = CURVE_SEGMENT_HIT_DISTANCE,
): number | null {
  const hit = nearestCurveParameter(curve, point)
  return hit.distance <= maxDistance ? hit.index : null
}

/** Return the actual cubic parameter, not a sampled world point used as a new anchor. */
export function nearestCurveParameter(curve: THREE.CurvePath<THREE.Vector3>, point: THREE.Vector3) {
  let result = { index: 0, t: 0, distance: Infinity }
  curve.curves.forEach((segment, index) => {
    let sample = 0, distance = Infinity
    for (let s = 0; s <= 64; s++) {
      const d = segment.getPoint(s / 64).distanceToSquared(point)
      if (d < distance) { sample = s / 64; distance = d }
    }
    let lo = Math.max(0, sample - 1 / 64), hi = Math.min(1, sample + 1 / 64)
    for (let n = 0; n < 24; n++) {
      const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3
      if (segment.getPoint(a).distanceToSquared(point) < segment.getPoint(b).distanceToSquared(point)) hi = b
      else lo = a
    }
    const t = (lo + hi) / 2
    distance = segment.getPoint(t).distanceTo(point)
    if (distance < result.distance) result = { index, t, distance }
  })
  return result
}
