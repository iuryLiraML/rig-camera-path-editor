import * as THREE from 'three'
import type { MotionPath, PathAnchor } from '../state/usePathStore'
import type { Vec3 } from '../state/useSceneStore'
import { computeAutoHandles, type HandleType, type TangentMode } from './curve'

export type HandleSide = 'in' | 'out'
const negate = (v: Vec3): Vec3 => v.map(x => -x) as Vec3
const length = (v: Vec3) => Math.hypot(...v)
const opposite = (direction: Vec3, magnitude: number): Vec3 => {
  const len = length(direction)
  return len > 1e-10 ? direction.map(x => -x * magnitude / len) as Vec3 : [0, 0, 0]
}
const typeKey = (side: HandleSide) => side === 'in' ? 'handleInType' : 'handleOutType'
const valueKey = (side: HandleSide) => side === 'in' ? 'handleIn' : 'handleOut'

/** The displayed controls are the starting geometry of every manual edit. */
export function editBezierHandle(path: MotionPath, id: string, side: HandleSide, value: Vec3, free: boolean): PathAnchor[] {
  const resolved = computeAutoHandles(path.anchors, path.closed, path.rounding)
  return path.anchors.map((anchor, index) => {
    if (anchor.id !== id) return anchor
    const shown = resolved[index]
    const wasAuto = !anchor.manual
    const other: HandleSide = side === 'in' ? 'out' : 'in'
    const kind: HandleType = wasAuto ? 'aligned' : anchor[typeKey(side)] ?? (anchor.mirrored ? 'aligned' : 'free')
    const next: PathAnchor = {
      ...shown, manual: true,
      mirrored: !free && !wasAuto && anchor.mirrored,
      handleInType: wasAuto ? 'aligned' : anchor.handleInType ?? (anchor.mirrored ? 'aligned' : 'free'),
      handleOutType: wasAuto ? 'aligned' : anchor.handleOutType ?? (anchor.mirrored ? 'aligned' : 'free'),
      [valueKey(side)]: [...value],
    }
    next[typeKey(side)] = free || kind === 'vector' ? 'free' : kind
    if (free) next[typeKey(other)] = 'free'
    if (next.mirrored) next[valueKey(other)] = negate(value)
    else if (next[typeKey(side)] === 'aligned' && next[typeKey(other)] === 'aligned' && length(value) > 1e-10) {
      next[valueKey(other)] = opposite(value, length(shown[valueKey(other)]))
    }
    return next
  })
}

export function changeBezierMode(path: MotionPath, ids: string[], mode: TangentMode, reference: HandleSide = 'out'): PathAnchor[] {
  const wanted = new Set(ids)
  const resolved = computeAutoHandles(path.anchors, path.closed, path.rounding)
  const canonical = mode === 'smooth' ? 'mirrored' : mode === 'broken' ? 'free' : mode
  return path.anchors.map((anchor, index) => {
    if (!wanted.has(anchor.id)) return anchor
    if (canonical === 'auto') return { ...anchor, manual: false, mirrored: false, handleInType: 'auto', handleOutType: 'auto' }
    const type = canonical === 'mirrored' ? 'aligned' : canonical === 'corner' ? 'free' : canonical
    const next: PathAnchor = { ...resolved[index], manual: true, mirrored: canonical === 'mirrored', handleInType: type, handleOutType: type }
    if (canonical === 'corner') {
      next.handleIn = [0, 0, 0]
      next.handleOut = [0, 0, 0]
    } else if (canonical === 'aligned' || canonical === 'mirrored') {
      const other = reference === 'out' ? 'in' : 'out'
      if (length(next[valueKey(reference)]) < 1e-10 && length(next[valueKey(other)]) > 1e-10) {
        // A collapsed reference acquires the existing tangent only on explicit conversion.
        next[valueKey(reference)] = negate(next[valueKey(other)])
      }
      if (length(next[valueKey(reference)]) > 1e-10) {
        next[valueKey(other)] = canonical === 'mirrored'
          ? negate(next[valueKey(reference)])
          : opposite(next[valueKey(reference)], length(next[valueKey(other)]))
      }
    }
    return next
  })
}

/** Freeze resolved controls before a topological edit so Auto/Vector cannot deform neighbors. */
function materialized(path: MotionPath, indices: number[]): PathAnchor[] {
  return computeAutoHandles(path.anchors, path.closed, path.rounding).map((a, i) => indices.includes(i) ? ({
    ...a, manual: true, mirrored: false, handleInType: 'free', handleOutType: 'free',
  }) : path.anchors[i])
}

export function splitBezierSegment(path: MotionPath, index: number, t: number, id: string): PathAnchor[] {
  const count = path.closed ? path.anchors.length : path.anchors.length - 1
  if (index < 0 || index >= count || t <= 0 || t >= 1) return path.anchors
  const anchors = materialized(path, [index, (index + 1) % path.anchors.length])
  const a = anchors[index], b = anchors[(index + 1) % anchors.length]
  const p0 = new THREE.Vector3(...a.position), p3 = new THREE.Vector3(...b.position)
  const p1 = p0.clone().add(new THREE.Vector3(...a.handleOut))
  const p2 = p3.clone().add(new THREE.Vector3(...b.handleIn))
  const q0 = p0.clone().lerp(p1, t), q1 = p1.clone().lerp(p2, t), q2 = p2.clone().lerp(p3, t)
  const r0 = q0.clone().lerp(q1, t), r1 = q1.clone().lerp(q2, t)
  const point = r0.clone().lerp(r1, t)
  a.handleOut = q0.sub(p0).toArray()
  b.handleIn = q2.sub(p3).toArray()
  anchors.splice(index + 1, 0, {
    id, position: point.toArray(), handleIn: r0.sub(point).toArray(), handleOut: r1.sub(point).toArray(),
    manual: true, mirrored: false, handleInType: 'aligned', handleOutType: 'aligned',
  })
  return anchors
}

/** Least-squares displacement of the two controls, keeping both anchors fixed. */
export function moveBezierSegment(path: MotionPath, index: number, t: number, delta: Vec3): PathAnchor[] {
  if (index < 0 || index >= (path.closed ? path.anchors.length : path.anchors.length - 1)) return path.anchors
  const anchors = materialized(path, [index, (index + 1) % path.anchors.length])
  const a = anchors[index], b = anchors[(index + 1) % anchors.length]
  const u = Math.max(.02, Math.min(.98, t))
  const w1 = 3 * (1 - u) ** 2 * u, w2 = 3 * (1 - u) * u * u
  const divisor = w1 * w1 + w2 * w2
  a.handleOut = a.handleOut.map((x, axis) => x + delta[axis] * w1 / divisor) as Vec3
  b.handleIn = b.handleIn.map((x, axis) => x + delta[axis] * w2 / divisor) as Vec3
  return anchors
}
