import * as THREE from 'three'
import type { Transform, Vec3 } from '../state/useSceneStore'
import type { AnchorRef, PathAnchor } from '../state/usePathStore'
import {
  localDirToWorld,
  localPointToWorld,
  worldDirToLocal,
  worldPointToLocal,
} from './pathSpace'

const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()

export type AnchorPoseSnapshot = {
  id: string
  position: Vec3
  handleIn: Vec3
  handleOut: Vec3
}

export interface WorldPathAnchors {
  pathId: string
  anchors: readonly PathAnchor[]
  parent: Transform | null
}

export interface WorldAnchorPoseSnapshot {
  ref: AnchorRef
  worldPosition: Vec3
  worldHandleIn: Vec3
  worldHandleOut: Vec3
  parent: Transform | null
}

/** Replace the selection with one id, or clear it. */
export function replaceAnchorSelection(id: string | null): string[] {
  return id ? [id] : []
}

/** Shift+click: add or remove `id`, preserving order of remaining ids. */
export function toggleAnchorSelection(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
}

/**
 * Click without Shift on a point that is already selected keeps the set so a
 * drag can move the group. Click on an unselected point replaces.
 */
export function clickAnchorSelection(ids: string[], id: string, additive: boolean): string[] {
  if (additive) return toggleAnchorSelection(ids, id)
  if (ids.includes(id) && ids.length > 1) return ids
  return replaceAnchorSelection(id)
}

/** Last id in the set is the primary (inspector / handles). */
export function primaryAnchorId(ids: string[]): string | null {
  return ids.length > 0 ? ids[ids.length - 1] : null
}

export function translateAnchors(
  anchors: PathAnchor[],
  ids: ReadonlySet<string> | readonly string[],
  delta: Vec3,
): PathAnchor[] {
  const selected = ids instanceof Set ? ids : new Set(ids)
  if (selected.size === 0) return anchors
  return anchors.map((anchor) => {
    if (!selected.has(anchor.id)) return anchor
    return {
      ...anchor,
      position: [
        anchor.position[0] + delta[0],
        anchor.position[1] + delta[1],
        anchor.position[2] + delta[2],
      ] as Vec3,
    }
  })
}

export function snapshotAnchors(anchors: PathAnchor[], ids: readonly string[]): AnchorPoseSnapshot[] {
  const wanted = new Set(ids)
  return anchors
    .filter((anchor) => wanted.has(anchor.id))
    .map((anchor) => ({
      id: anchor.id,
      position: [...anchor.position] as Vec3,
      handleIn: [...anchor.handleIn] as Vec3,
      handleOut: [...anchor.handleOut] as Vec3,
    }))
}

export function centroidOf(points: readonly Vec3[]): Vec3 {
  if (points.length === 0) return [0, 0, 0]
  let x = 0
  let y = 0
  let z = 0
  for (const point of points) {
    x += point[0]
    y += point[1]
    z += point[2]
  }
  const n = points.length
  return [x / n, y / n, z / n]
}

function cloneTransform(transform: Transform | null): Transform | null {
  if (!transform) return null
  return {
    position: [...transform.position] as Vec3,
    rotation: [...transform.rotation] as Vec3,
    scale: [...transform.scale] as Vec3,
  }
}

/** Captures immutable world-space drag-start poses in reference order. */
export function snapshotWorldAnchors(
  paths: readonly WorldPathAnchors[],
  refs: readonly AnchorRef[],
): WorldAnchorPoseSnapshot[] {
  const byPath = new Map(paths.map((path) => [path.pathId, path]))
  const snapshots: WorldAnchorPoseSnapshot[] = []
  for (const ref of refs) {
    const path = byPath.get(ref.pathId)
    const anchor = path?.anchors.find((candidate) => candidate.id === ref.anchorId)
    if (!path || !anchor) continue
    const parent = cloneTransform(path.parent)
    snapshots.push({
      ref: { ...ref },
      worldPosition: parent
        ? localPointToWorld(anchor.position, parent)
        : [...anchor.position] as Vec3,
      worldHandleIn: parent
        ? localDirToWorld(anchor.handleIn, parent)
        : [...anchor.handleIn] as Vec3,
      worldHandleOut: parent
        ? localDirToWorld(anchor.handleOut, parent)
        : [...anchor.handleOut] as Vec3,
      parent,
    })
  }
  return snapshots
}

export function worldAnchorPivot(snapshot: readonly WorldAnchorPoseSnapshot[]): Vec3 {
  return centroidOf(snapshot.map((anchor) => anchor.worldPosition))
}

function rotateScaleOffset(offset: Vec3, quat: THREE.Quaternion, scale: Vec3): Vec3 {
  _v.set(offset[0] * scale[0], offset[1] * scale[1], offset[2] * scale[2])
  _v.applyQuaternion(quat)
  return [_v.x, _v.y, _v.z]
}

/**
 * Applies one visual-space pose to immutable snapshots, then groups local-space
 * results by owning path for atomic path updates.
 */
export function transformWorldAnchorSnapshots(
  snapshot: readonly WorldAnchorPoseSnapshot[],
  startPivot: Vec3,
  currentPivot: Vec3,
  quat: readonly [number, number, number, number],
  scale: Vec3,
): Map<string, AnchorPoseSnapshot[]> {
  const grouped = new Map<string, AnchorPoseSnapshot[]>()
  _q.set(quat[0], quat[1], quat[2], quat[3])
  for (const anchor of snapshot) {
    const offset = rotateScaleOffset(
      [
        anchor.worldPosition[0] - startPivot[0],
        anchor.worldPosition[1] - startPivot[1],
        anchor.worldPosition[2] - startPivot[2],
      ],
      _q,
      scale,
    )
    const worldPosition: Vec3 = [
      currentPivot[0] + offset[0],
      currentPivot[1] + offset[1],
      currentPivot[2] + offset[2],
    ]
    const worldHandleIn = rotateScaleOffset(anchor.worldHandleIn, _q, scale)
    const worldHandleOut = rotateScaleOffset(anchor.worldHandleOut, _q, scale)
    const result: AnchorPoseSnapshot = {
      id: anchor.ref.anchorId,
      position: anchor.parent
        ? worldPointToLocal(worldPosition, anchor.parent)
        : worldPosition,
      handleIn: anchor.parent
        ? worldDirToLocal(worldHandleIn, anchor.parent)
        : worldHandleIn,
      handleOut: anchor.parent
        ? worldDirToLocal(worldHandleOut, anchor.parent)
        : worldHandleOut,
    }
    const pathResults = grouped.get(anchor.ref.pathId)
    if (pathResults) pathResults.push(result)
    else grouped.set(anchor.ref.pathId, [result])
  }
  return grouped
}

/**
 * Apply a TransformControls pose (pivot + quaternion + scale) to every
 * snapped point. Positions orbit the pivot; handles rotate and scale with
 * the same pose so a group rotate/scale keeps tangents aligned.
 */
export function transformAnchorsAroundPivot(
  anchors: PathAnchor[],
  snapshot: readonly AnchorPoseSnapshot[],
  startPivot: Vec3,
  currentPivot: Vec3,
  quat: readonly [number, number, number, number],
  scale: Vec3,
): PathAnchor[] {
  if (snapshot.length === 0) return anchors
  const byId = new Map(snapshot.map((item) => [item.id, item]))
  _q.set(quat[0], quat[1], quat[2], quat[3])
  return anchors.map((anchor) => {
    const snap = byId.get(anchor.id)
    if (!snap) return anchor
    const offset = rotateScaleOffset(
      [
        snap.position[0] - startPivot[0],
        snap.position[1] - startPivot[1],
        snap.position[2] - startPivot[2],
      ],
      _q,
      scale,
    )
    return {
      ...anchor,
      position: [currentPivot[0] + offset[0], currentPivot[1] + offset[1], currentPivot[2] + offset[2]] as Vec3,
      handleIn: rotateScaleOffset(snap.handleIn, _q, scale),
      handleOut: rotateScaleOffset(snap.handleOut, _q, scale),
    }
  })
}
