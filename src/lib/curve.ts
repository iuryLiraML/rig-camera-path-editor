import * as THREE from 'three'
import type { PathAnchor } from '../state/useRigStore'
import type { Vec3 } from '../state/useSceneStore'

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

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
 * Manual anchors keep their stored handles untouched.
 */
export function computeAutoHandles(
  anchors: PathAnchor[],
  closed: boolean,
  rounding: number,
): PathAnchor[] {
  const n = anchors.length
  if (n < 2) return anchors
  return anchors.map((anchor, i) => {
    if (anchor.manual) return anchor

    const prevA = closed ? anchors[(i - 1 + n) % n] : anchors[Math.max(0, i - 1)]
    const nextA = closed ? anchors[(i + 1) % n] : anchors[Math.min(n - 1, i + 1)]
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
