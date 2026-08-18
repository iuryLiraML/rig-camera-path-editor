import * as THREE from 'three'
import { applyCubicBezier, applyEase, easeDef, type EaseKind } from './easing'
import { applySpacing, DEFAULT_SPACING } from './intervalSpacing'
import type { Transform, Vec3 } from '../state/useSceneStore'

/** Every keyframe can carry the curve used to leave it. */
interface KeyBase {
  id: string
  /** normalized position on the timeline (0..1) */
  time: number
  /** curve for the segment that STARTS at this key; falls back to the rig default */
  ease?: EaseKind
  /**
   * Manual cubic-bezier for the outgoing segment. When set, this wins over
   * `ease` so the graph editor can pull handles without renaming the curve.
   */
  easeBezier?: [number, number, number, number]
  /**
   * Incoming interval weight (0..1, default 0.5). Linger at this key when
   * below 0.5, rush into it when above. Does not change the keyed value.
   */
  easeIn?: number
  /**
   * Outgoing interval weight (0..1, default 0.5). Linger at this key when
   * below 0.5, rush away when above.
   */
  easeOut?: number
}

/** Linear time inside a segment, then Cascadeur-style spacing, then the named curve. */
function easedU(u: number, a: KeyBase, b: KeyBase, defaultEase: EaseKind): number {
  const spaced = applySpacing(u, a.easeOut ?? DEFAULT_SPACING, b.easeIn ?? DEFAULT_SPACING)
  if (a.easeBezier) return applyCubicBezier(a.easeBezier, spaced)
  return applyEase(a.ease ?? defaultEase, spaced)
}

/** Bezier used to leave this key — custom handles, else the named curve. */
export function keyOutgoingBezier(
  key: { ease?: EaseKind; easeBezier?: [number, number, number, number] },
  defaultEase: EaseKind,
): [number, number, number, number] {
  return key.easeBezier ?? easeDef(key.ease ?? defaultEase).bezier
}

export interface ProgressKey extends KeyBase {
  /** normalized position along the camera path (0..1) */
  progress: number
}

/** a scalar camera channel over time — FOV, roll */
export interface ValueKey extends KeyBase {
  value: number
}

/** the look-at target over time, so a move can change subject mid-shot */
export interface Vec3Key extends KeyBase {
  value: Vec3
}

export interface ModelKey extends KeyBase {
  transform: Transform
}

/** normalized position within the segment of `sorted` that contains `t` */
function segment<K extends KeyBase>(t: number, sorted: K[]) {
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (t <= b.time) {
      const span = b.time - a.time
      return { a, b, u: span < 1e-6 ? 1 : (t - a.time) / span }
    }
  }
  const last = sorted[sorted.length - 1]
  return { a: last, b: last, u: 1 }
}

/**
 * Time → path-position curve. User keyframes pin the camera to a spot on the
 * path at a moment in time; implicit endpoints (start of path at 0s, end of
 * path at the last second) fill in whatever the user didn't pin, so with zero
 * keyframes this reduces to the rig's default curve across the whole shot.
 */
export function evalProgress(t: number, keys: ProgressKey[], defaultEase: EaseKind): number {
  const pts: ProgressKey[] = [...keys]
  if (!pts.some((p) => p.time <= 0.001)) pts.push({ id: 'implicit-start', time: 0, progress: 0 })
  if (!pts.some((p) => p.time >= 0.999)) pts.push({ id: 'implicit-end', time: 1, progress: 1 })
  pts.sort((a, b) => a.time - b.time)

  if (t <= pts[0].time) return pts[0].progress
  const { a, b, u } = segment(t, pts)
  return a.progress + (b.progress - a.progress) * easedU(u, a, b, defaultEase)
}

/**
 * A scalar camera channel (FOV, roll) at time t. With no keyframes the static
 * value wins, so adding the first key is what turns the channel into animation.
 */
export function evalValue(
  t: number,
  keys: ValueKey[],
  fallback: number,
  defaultEase: EaseKind,
): number {
  if (keys.length === 0) return fallback
  const sorted = [...keys].sort((x, y) => x.time - y.time)
  if (t <= sorted[0].time) return sorted[0].value
  const last = sorted[sorted.length - 1]
  if (t >= last.time) return last.value
  const { a, b, u } = segment(t, sorted)
  return a.value + (b.value - a.value) * easedU(u, a, b, defaultEase)
}

/** The look-at target at time t; component-wise, same rules as evalValue. */
export function evalVec3(
  t: number,
  keys: Vec3Key[],
  fallback: Vec3,
  defaultEase: EaseKind,
): Vec3 {
  if (keys.length === 0) return fallback
  const sorted = [...keys].sort((x, y) => x.time - y.time)
  if (t <= sorted[0].time) return sorted[0].value
  const last = sorted[sorted.length - 1]
  if (t >= last.time) return last.value
  const { a, b, u } = segment(t, sorted)
  const e = easedU(u, a, b, defaultEase)
  return [
    a.value[0] + (b.value[0] - a.value[0]) * e,
    a.value[1] + (b.value[1] - a.value[1]) * e,
    a.value[2] + (b.value[2] - a.value[2]) * e,
  ]
}

const DEG = Math.PI / 180
const RAD = 180 / Math.PI
const qa = new THREE.Quaternion()
const qb = new THREE.Quaternion()
const euler = new THREE.Euler()

/** Interpolated model pose at time t, or null when there are no keyframes. */
export function evalModelTransform(
  t: number,
  keys: ModelKey[],
  defaultEase: EaseKind,
): Transform | null {
  if (keys.length === 0) return null
  const sorted = [...keys].sort((a, b) => a.time - b.time)
  if (t <= sorted[0].time) return sorted[0].transform
  const last = sorted[sorted.length - 1]
  if (t >= last.time) return last.transform

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (t <= b.time) {
      const span = b.time - a.time
      const raw = span < 1e-6 ? 1 : (t - a.time) / span
      const u = easedU(raw, a, b, defaultEase)
      const lerp = (x: number, y: number) => x + (y - x) * u
      const ta = a.transform
      const tb = b.transform
      qa.setFromEuler(euler.set(ta.rotation[0] * DEG, ta.rotation[1] * DEG, ta.rotation[2] * DEG))
      qb.setFromEuler(euler.set(tb.rotation[0] * DEG, tb.rotation[1] * DEG, tb.rotation[2] * DEG))
      qa.slerp(qb, u)
      euler.setFromQuaternion(qa)
      return {
        position: [
          lerp(ta.position[0], tb.position[0]),
          lerp(ta.position[1], tb.position[1]),
          lerp(ta.position[2], tb.position[2]),
        ],
        rotation: [euler.x * RAD, euler.y * RAD, euler.z * RAD],
        scale: [
          lerp(ta.scale[0], tb.scale[0]),
          lerp(ta.scale[1], tb.scale[1]),
          lerp(ta.scale[2], tb.scale[2]),
        ],
      }
    }
  }
  return last.transform
}

/** Two keyframes closer than this on the timeline count as the same one. */
export const KEY_MERGE_EPS = 0.02
