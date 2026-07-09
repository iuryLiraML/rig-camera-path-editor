import * as THREE from 'three'
import { easeSmooth } from './curve'
import type { Transform } from '../state/useSceneStore'

export interface ProgressKey {
  id: string
  /** normalized position on the timeline (0..1) */
  time: number
  /** normalized position along the camera path (0..1) */
  progress: number
}

export interface ModelKey {
  id: string
  /** normalized position on the timeline (0..1) */
  time: number
  transform: Transform
}

/**
 * Time → path-position curve. User keyframes pin the camera to a spot on the
 * path at a moment in time; implicit endpoints (start of path at 0s, end of
 * path at the last second) fill in whatever the user didn't pin, so with zero
 * keyframes this reduces to the plain smoothness easing.
 */
export function evalProgress(t: number, keys: ProgressKey[], smoothness: number): number {
  const pts: { time: number; progress: number }[] = keys.map((k) => ({
    time: k.time,
    progress: k.progress,
  }))
  if (!pts.some((p) => p.time <= 0.001)) pts.push({ time: 0, progress: 0 })
  if (!pts.some((p) => p.time >= 0.999)) pts.push({ time: 1, progress: 1 })
  pts.sort((a, b) => a.time - b.time)

  if (t <= pts[0].time) return pts[0].progress
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (t <= b.time) {
      const span = b.time - a.time
      const u = span < 1e-6 ? 1 : (t - a.time) / span
      return a.progress + (b.progress - a.progress) * easeSmooth(u, smoothness)
    }
  }
  return pts[pts.length - 1].progress
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
  smoothness: number,
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
      const u = easeSmooth(span < 1e-6 ? 1 : (t - a.time) / span, smoothness)
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
