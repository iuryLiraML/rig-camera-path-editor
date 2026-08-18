import * as THREE from 'three'
import type { Vec3 } from '../state/useSceneStore'
import type { PathAnchor } from '../state/usePathStore'

const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()

export type AnchorPoseSnapshot = {
  id: string
  position: Vec3
  handleIn: Vec3
  handleOut: Vec3
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

function rotateScaleOffset(offset: Vec3, quat: THREE.Quaternion, scale: Vec3): Vec3 {
  _v.set(offset[0] * scale[0], offset[1] * scale[1], offset[2] * scale[2])
  _v.applyQuaternion(quat)
  return [_v.x, _v.y, _v.z]
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
