import { useCameraOptionsStore } from '../state/useCameraOptionsStore'
import { useEditorStore } from '../state/useEditorStore'
import { usePathStore } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'
import type { Vec3 } from '../state/useSceneStore'

export const MAX_DRAW_ANCHORS = 64
/** Drawn paths use full auto-handles so the camera does not inherit hand jitter. */
export const DRAW_PATH_ROUNDING = 1

const SMOOTH_ITERS = 8
const SMOOTH_AMOUNT = 0.55

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function xzDist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2])
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export function polylineLength(points: Vec3[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) length += dist(points[i - 1], points[i])
  return length
}

export function samplePolylineAt(points: Vec3[], s: number): Vec3 {
  if (points.length === 0) return [0, 0, 0]
  if (points.length === 1 || s <= 0) return points[0]
  let acc = 0
  for (let i = 1; i < points.length; i++) {
    const seg = dist(points[i - 1], points[i])
    const last = i === points.length - 1
    if (acc + seg >= s || last) {
      const t = seg > 1e-8 ? (s - acc) / seg : 0
      return lerp(points[i - 1], points[i], Math.min(1, Math.max(0, t)))
    }
    acc += seg
  }
  return points[points.length - 1]
}

function distPointToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ap: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
  const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]
  if (ab2 < 1e-16) return dist(p, a)
  const t = Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ab2))
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t])
}

function rdpSlice(points: Vec3[], i: number, j: number, epsilon: number): Vec3[] {
  let maxD = -1
  let maxK = -1
  for (let k = i + 1; k < j; k++) {
    const d = distPointToSegment(points[k], points[i], points[j])
    if (d > maxD) {
      maxD = d
      maxK = k
    }
  }
  if (maxD > epsilon && maxK > i) {
    const left = rdpSlice(points, i, maxK, epsilon)
    const right = rdpSlice(points, maxK, j, epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [points[i], points[j]]
}

function averagePoints(points: Vec3[]): Vec3 {
  const acc: Vec3 = [0, 0, 0]
  for (const p of points) {
    acc[0] += p[0]
    acc[1] += p[1]
    acc[2] += p[2]
  }
  const n = Math.max(1, points.length)
  return [acc[0] / n, acc[1] / n, acc[2] / n]
}

/** Replace jittery start/end with a short window average so the camera does not kick off a bump. */
export function blendEnds(points: Vec3[], window = 7): Vec3[] {
  if (points.length < window + 2) return points
  const head = averagePoints(points.slice(0, window))
  const tail = averagePoints(points.slice(-window))
  return [head, ...points.slice(1, -1), tail]
}

/** Laplacian pass. Open strokes pin the (already blended) ends; loops wrap. */
export function smoothPolyline(
  points: Vec3[],
  iterations = SMOOTH_ITERS,
  amount = SMOOTH_AMOUNT,
  closed = false,
): Vec3[] {
  const unique = dedupeConsecutive(points)
  if (unique.length < 3) return unique
  let cur = unique
  const a = Math.min(1, Math.max(0, amount))
  for (let n = 0; n < iterations; n++) {
    const next: Vec3[] = []
    for (let i = 0; i < cur.length; i++) {
      const isEnd = !closed && (i === 0 || i === cur.length - 1)
      if (isEnd) {
        next.push(cur[i])
        continue
      }
      const prev = cur[(i - 1 + cur.length) % cur.length]
      const nxt = cur[(i + 1) % cur.length]
      const avg: Vec3 = [
        (prev[0] + cur[i][0] + nxt[0]) / 3,
        (prev[1] + cur[i][1] + nxt[1]) / 3,
        (prev[2] + cur[i][2] + nxt[2]) / 3,
      ]
      next.push(lerp(cur[i], avg, a))
    }
    cur = next
  }
  return cur
}

/** Drop points that sit almost on the chord — keeps the gesture, kills tremor. */
export function simplifyRdp(points: Vec3[], epsilon: number): Vec3[] {
  const unique = dedupeConsecutive(points)
  if (unique.length <= 2 || !(epsilon > 0)) return unique
  return rdpSlice(unique, 0, unique.length - 1, epsilon)
}

function rdpEpsilon(points: Vec3[]): number {
  const length = polylineLength(points)
  return Math.min(0.5, Math.max(0.16, length * 0.03))
}

function resampleSpacing(points: Vec3[]): number {
  const length = polylineLength(points)
  return Math.max(0.4, length / 16)
}

function dedupeConsecutive(points: Vec3[]): Vec3[] {
  const out: Vec3[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && dist(last, p) < 1e-6) continue
    out.push(p)
  }
  return out
}

/** Even samples along the stroke. Spacing is one grid cell; count is capped. */
export function resampleArcLength(
  points: Vec3[],
  spacing: number,
  maxAnchors = MAX_DRAW_ANCHORS,
): Vec3[] {
  const unique = dedupeConsecutive(points)
  if (unique.length === 0) return []
  if (unique.length === 1) return [unique[0]]
  const length = polylineLength(unique)
  if (length < 1e-8) return [unique[0]]
  const cell = spacing > 0 ? spacing : length
  const desired = Math.floor(length / cell) + 1
  const n = Math.min(maxAnchors, Math.max(2, desired))
  const step = length / (n - 1)
  const out: Vec3[] = []
  for (let i = 0; i < n; i++) {
    out.push(samplePolylineAt(unique, i === n - 1 ? length : i * step))
  }
  return dedupeConsecutive(out)
}

export function strokeTooShort(points: Vec3[], cell: number): boolean {
  if (points.length < 2) return true
  const start = points[0]
  let farthest = 0
  for (const p of points) farthest = Math.max(farthest, xzDist(start, p))
  return farthest < cell
}

export function shouldCloseLoop(points: Vec3[], cell: number): boolean {
  if (points.length < 2) return false
  return xzDist(points[0], points[points.length - 1]) <= cell + 1e-6
}

/**
 * Smooth, simplify, then resample. Grid size is only a length threshold
 * (too-short / close-loop), not a snap.
 */
export function finalizeDrawStroke(
  raw: Vec3[],
  gridSize: number,
): { positions: Vec3[]; closed: boolean } | null {
  if (!(gridSize > 0) || strokeTooShort(raw, gridSize)) return null
  const unique = dedupeConsecutive(raw)
  const closedHint = shouldCloseLoop(unique, gridSize)
  const longStroke = unique.length >= 8
  const prepared = longStroke && !closedHint ? blendEnds(unique) : unique
  const smoothed = smoothPolyline(
    prepared,
    longStroke ? SMOOTH_ITERS : 2,
    SMOOTH_AMOUNT,
    closedHint,
  )
  const even = resampleArcLength(smoothed, resampleSpacing(smoothed))
  let positions = longStroke ? simplifyRdp(even, rdpEpsilon(even)) : even
  if (positions.length < 2) positions = resampleArcLength(unique, resampleSpacing(unique))
  if (positions.length < 2) return null
  if (closedHint && positions.length > 2) {
    positions = positions.slice(0, -1)
  }
  const closed = closedHint && positions.length >= 3
  if (positions.length < 2) return null
  return { positions, closed }
}

/** Draw listens on the canvas — stay out of look-through / play so fly keeps LMB and wheel. */
export function shouldHandleDrawInput(): boolean {
  const editor = useEditorStore.getState()
  return !editor.cameraView && !editor.playMode && editor.workspaceMode === 'compose'
}

/** Construction height: Free-camera Y, otherwise a usable aerial default. */
export function defaultDrawHeight(): number {
  const rig = useRigStore.getState()
  if (rig.cameraKind === 'static') return rig.staticPose.position[1]
  return 1.5
}

/**
 * Always a new path. The active camera follows it and switches to On path
 * so the curve is visible. History restores the previous follow + kind.
 */
export function commitDrawPath(positions: Vec3[], closed: boolean): string | null {
  if (positions.length < 2) return null
  const paths = usePathStore.getState()
  const id = paths.createPath()
  paths.setPath(positions, closed)
  paths.setRounding(DRAW_PATH_ROUNDING)
  const rig = useRigStore.getState()
  rig.setCameraPath(id)
  if (rig.cameraKind !== 'path') rig.setCameraKind('path')
  // Stroke is world-grid. An object-parented follow would treat those
  // anchors as local and the new path would not match what was drawn.
  if (rig.pathSpace === 'object') rig.setPathSpace('world')
  useCameraOptionsStore.getState().captureActive()
  useEditorStore.getState().select('camera-path')
  return id
}
