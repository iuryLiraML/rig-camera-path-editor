import * as THREE from 'three'
import type { MotionPath } from '../state/usePathStore'
import type { Vec3 } from '../state/useSceneStore'
import { buildCurve, computeAutoHandles } from './curve'
import type { HandleSide } from './bezierEditing'

export type BezierHit =
  | { kind: 'anchor'; id: string; local: Vec3 }
  | { kind: 'handle'; id: string; side: HandleSide; local: Vec3 }
  | { kind: 'segment'; index: number; t: number; local: Vec3 }

/** The same CSS-pixel targets drive Pen/Select hover and pointer-down. */
export function pickBezier(
  path: MotionPath,
  cursor: { x: number; y: number },
  project: (local: Vec3) => { x: number; y: number },
  handleIds: ReadonlySet<string>,
): BezierHit | null {
  const distance = (local: Vec3) => {
    const p = project(local)
    return Math.hypot(p.x - cursor.x, p.y - cursor.y)
  }
  let best: BezierHit | null = null
  let dist = 12
  const resolved = computeAutoHandles(path.anchors, path.closed, path.rounding)
  for (const a of resolved) {
    const d = distance(a.position)
    if (d <= dist) { best = { kind: 'anchor', id: a.id, local: a.position }; dist = d }
  }
  for (const a of resolved) {
    if (!handleIds.has(a.id)) continue
    for (const side of ['in', 'out'] as const) {
      const handle = side === 'in' ? a.handleIn : a.handleOut
      // A collapsed control is pulled explicitly from the anchor; it must not hide the anchor target.
      if (Math.hypot(...handle) < 1e-8) continue
      const local = a.position.map((v, i) => v + handle[i]) as Vec3
      const d = distance(local)
      if (d <= dist) { best = { kind: 'handle', id: a.id, side, local }; dist = d }
    }
  }
  if (best) return best
  const curve = buildCurve(path.anchors, path.closed, path.rounding)
  let segmentDist = 8
  curve?.curves.forEach((segment, index) => {
    let nearest = 0, min = Infinity
    for (let s = 0; s <= 64; s++) {
      const d = distance(segment.getPoint(s / 64).toArray())
      if (d < min) { min = d; nearest = s / 64 }
    }
    if (min > segmentDist + 2) return
    let low = Math.max(0, nearest - 1 / 64), high = Math.min(1, nearest + 1 / 64)
    for (let i = 0; i < 18; i++) {
      const a = low + (high - low) / 3, b = high - (high - low) / 3
      if (distance(segment.getPoint(a).toArray()) < distance(segment.getPoint(b).toArray())) high = b
      else low = a
    }
    const t = (low + high) / 2
    const local = segment.getPoint(t).toArray()
    const d = distance(local)
    if (d < segmentDist) { best = { kind: 'segment', index, t, local }; segmentDist = d }
  })
  return best
}

/** Preserve the grab offset. Plane/camera are frozen by the gesture owner. */
export function viewDragPlane(camera: THREE.Camera, point: Vec3): THREE.Plane {
  const normal = camera.getWorldDirection(new THREE.Vector3())
  // Axis views have a small tilt to keep OrbitControls away from its poles.
  // Their editing planes are still exact XZ / XY / YZ, so Top never changes height.
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(normal.getComponent(axis)) > .98) {
      const sign = Math.sign(normal.getComponent(axis))
      normal.set(0, 0, 0).setComponent(axis, sign)
      break
    }
  }
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(...point))
}
