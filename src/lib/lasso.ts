import * as THREE from 'three'
import type { AnchorRef, MotionPath } from '../state/usePathStore'
import type { SelectionMemberId } from '../state/useEditorStore'
import type { Transform } from '../state/useSceneStore'
import { buildCurve } from './curve'
import { matrixFromTransform } from './pathSpace'

export interface ScreenPoint {
  x: number
  y: number
}

export interface PaneSize {
  w: number
  h: number
}

const EDGE_EPSILON = 1e-6

function pointOnSegment(point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): boolean {
  const lengthSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  if (lengthSq <= EDGE_EPSILON * EDGE_EPSILON) {
    return (point.x - a.x) ** 2 + (point.y - a.y) ** 2 <= EDGE_EPSILON * EDGE_EPSILON
  }
  const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y)
  if (Math.abs(cross) > EDGE_EPSILON) return false
  const dot = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)
  if (dot < -EDGE_EPSILON) return false
  return dot <= lengthSq + EDGE_EPSILON
}

/** Even-odd fill with boundary points included, matching a drawn lasso. */
export function pointInPolygon(point: ScreenPoint, polygon: ScreenPoint[]): boolean {
  if (polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]
    const b = polygon[i]
    if (pointOnSegment(point, a, b)) return true
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside
    }
  }
  return inside
}

const cameraPoint = new THREE.Vector3()
const projectedPoint = new THREE.Vector3()

/** Projects a world point to coordinates local to one pane. */
export function projectToPane(
  world: THREE.Vector3,
  camera: THREE.Camera,
  pane: PaneSize,
): ScreenPoint | null {
  cameraPoint.copy(world).applyMatrix4(camera.matrixWorldInverse)
  if (cameraPoint.z >= 0) return null
  projectedPoint.copy(world).project(camera)
  if (
    !Number.isFinite(projectedPoint.x) ||
    !Number.isFinite(projectedPoint.y) ||
    projectedPoint.z < -1 ||
    projectedPoint.z > 1
  ) {
    return null
  }
  return {
    x: (projectedPoint.x + 1) * 0.5 * pane.w,
    y: (1 - projectedPoint.y) * 0.5 * pane.h,
  }
}

/** World AABB center plus all corners; any representative inside counts as a hit. */
export function objectRepresentativePoints(object: THREE.Object3D): THREE.Vector3[] {
  object.updateWorldMatrix(true, true)
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return []
  const points = [box.getCenter(new THREE.Vector3())]
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z))
    }
  }
  return points
}

export function projectObjectToPane(
  object: THREE.Object3D,
  camera: THREE.Camera,
  pane: PaneSize,
): ScreenPoint[] {
  return objectRepresentativePoints(object)
    .map((point) => projectToPane(point, camera, pane))
    .filter((point): point is ScreenPoint => point !== null)
}

export function samplePathToPane(
  path: MotionPath,
  camera: THREE.Camera,
  pane: PaneSize,
  parent: Transform | null,
  sampleCount = Math.max(64, path.anchors.length * 24),
): ScreenPoint[] {
  const curve = buildCurve(path.anchors, path.closed, path.rounding)
  if (!curve) return []
  const parentMatrix = parent ? matrixFromTransform(parent, new THREE.Matrix4()) : null
  const points: ScreenPoint[] = []
  for (let i = 0; i <= sampleCount; i++) {
    const world = curve.getPoint(i / sampleCount)
    if (parentMatrix) world.applyMatrix4(parentMatrix)
    const screen = projectToPane(world, camera, pane)
    if (screen) points.push(screen)
  }
  return points
}

export interface LassoCandidate {
  id: SelectionMemberId
  points: ScreenPoint[]
}

export interface ProjectedAnchorCandidate {
  ref: AnchorRef
  point: ScreenPoint
}

export type LassoResultHit =
  | { kind: 'top-level'; id: SelectionMemberId }
  | { kind: 'anchor'; ref: AnchorRef }

/**
 * Projects anchor centers once when a lasso completes. Anchor order is retained
 * so callers can deterministically choose the final hit as primary.
 */
export function projectPathAnchorsToPane(
  path: MotionPath,
  camera: THREE.Camera,
  pane: PaneSize,
  parent: Transform | null,
): ProjectedAnchorCandidate[] {
  const parentMatrix = parent ? matrixFromTransform(parent, new THREE.Matrix4()) : null
  const candidates: ProjectedAnchorCandidate[] = []
  for (const anchor of path.anchors) {
    const world = new THREE.Vector3(...anchor.position)
    if (parentMatrix) world.applyMatrix4(parentMatrix)
    const point = projectToPane(world, camera, pane)
    if (!point || point.x < 0 || point.x > pane.w || point.y < 0 || point.y > pane.h) continue
    candidates.push({
      ref: { pathId: path.id, anchorId: anchor.id },
      point,
    })
  }
  return candidates
}

export function collectAnchorLassoHits(
  polygon: ScreenPoint[],
  candidates: readonly ProjectedAnchorCandidate[],
): AnchorRef[] {
  const hits: AnchorRef[] = []
  for (const candidate of candidates) {
    if (pointInPolygon(candidate.point, polygon)) hits.push(candidate.ref)
  }
  return hits
}

/** Candidate order is retained so the final hit deterministically becomes active. */
export function collectLassoHits(
  polygon: ScreenPoint[],
  candidates: LassoCandidate[],
): SelectionMemberId[] {
  const hits: SelectionMemberId[] = []
  for (const candidate of candidates) {
    if (candidate.points.some((point) => pointInPolygon(point, polygon))) hits.push(candidate.id)
  }
  return hits
}

/**
 * Produces one deterministic release result. Top-level members retain their
 * existing order and anchor centers follow them so the final anchor can own
 * the point-editing context without discarding whole-curve or object hits.
 */
export function collectLassoResult(
  polygon: ScreenPoint[],
  candidates: LassoCandidate[],
  anchorCandidates: readonly ProjectedAnchorCandidate[],
): LassoResultHit[] {
  return [
    ...collectLassoHits(polygon, candidates).map(
      (id): LassoResultHit => ({ kind: 'top-level', id }),
    ),
    ...collectAnchorLassoHits(polygon, anchorCandidates).map(
      (ref): LassoResultHit => ({ kind: 'anchor', ref }),
    ),
  ]
}

/** Distance-based sampling cap for pointermove without changing lasso topology. */
export function appendLassoPoint(
  points: ScreenPoint[],
  point: ScreenPoint,
  minimumDistance = 2,
  maximumPoints = 256,
): boolean {
  const previous = points.at(-1)
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < minimumDistance) {
    return false
  }
  if (points.length >= maximumPoints) {
    for (let read = 2, write = 1; read < points.length; read += 2, write++) {
      points[write] = points[read]
    }
    points.length = Math.ceil(points.length / 2)
  }
  points.push(point)
  return true
}
