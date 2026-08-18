import * as THREE from 'three'
import type { Vec3 } from '../state/useSceneStore'

const _n = new THREE.Vector3()
const _d = new THREE.Vector3()
const _o = new THREE.Vector3()
const _p = new THREE.Vector3()

/** Intersection of a ray with an infinite plane, or null if it misses / is behind. */
export function hitOnPlane(
  rayOrigin: Vec3,
  rayDir: Vec3,
  planePoint: Vec3,
  planeNormal: Vec3,
): Vec3 | null {
  _o.set(...rayOrigin)
  _d.set(...rayDir)
  _p.set(...planePoint)
  _n.set(...planeNormal)
  const len = _n.length()
  if (len < 1e-8) return null
  _n.multiplyScalar(1 / len)
  const denom = _d.dot(_n)
  if (Math.abs(denom) < 1e-6) return null
  const t = _p.sub(_o).dot(_n) / denom
  if (t < 0) return null
  _o.addScaledVector(_d, t)
  return [_o.x, _o.y, _o.z]
}

export function xzNormal(): Vec3 {
  return [0, 1, 0]
}

export function subtract3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function snapVec3(v: Vec3, size: number, axes: 'xz' | 'xyz' = 'xyz'): Vec3 {
  const step = Math.max(1e-6, size)
  const q = (n: number) => Math.round(n / step) * step
  switch (axes) {
    case 'xz':
      return [q(v[0]), v[1], q(v[2])]
    case 'xyz':
      return [q(v[0]), q(v[1]), q(v[2])]
    default: {
      const _never: never = axes
      return _never
    }
  }
}

export type ObjectDragMode = 'ground' | 'lift'

export function objectDragMode(shift: boolean): ObjectDragMode {
  return shift ? 'lift' : 'ground'
}

/**
 * Ground = XZ at the object's height (same language as path handles).
 * Lift = vertical plane facing the camera, so Shift only changes Y.
 */
export function objectDragPlane(
  object: Vec3,
  cameraDir: Vec3,
  mode: ObjectDragMode,
): { point: Vec3; normal: Vec3 } {
  switch (mode) {
    case 'ground':
      return { point: object, normal: xzNormal() }
    case 'lift': {
      const len = Math.hypot(cameraDir[0], cameraDir[2])
      const normal: Vec3 = len < 1e-6 ? [0, 0, 1] : [cameraDir[0] / len, 0, cameraDir[2] / len]
      return { point: object, normal }
    }
    default: {
      const _never: never = mode
      return _never
    }
  }
}

export function applyObjectDrag(hit: Vec3, grab: Vec3, keep: Vec3, mode: ObjectDragMode): Vec3 {
  const raw = add3(hit, grab)
  switch (mode) {
    case 'ground':
      return [raw[0], keep[1], raw[2]]
    case 'lift':
      return [keep[0], raw[1], keep[2]]
    default: {
      const _never: never = mode
      return _never
    }
  }
}

export function snapObjectDrag(v: Vec3, size: number, mode: ObjectDragMode): Vec3 {
  switch (mode) {
    case 'ground':
      return snapVec3(v, size, 'xz')
    case 'lift': {
      const snapped = snapVec3(v, size, 'xyz')
      return [v[0], snapped[1], v[2]]
    }
    default: {
      const _never: never = mode
      return _never
    }
  }
}

/** Slide camera + look-at together on XZ so framing is preserved (ground truck). */
export function truckOnGround(
  camera: Vec3,
  target: Vec3,
  from: Vec3,
  to: Vec3,
): { camera: Vec3; target: Vec3 } {
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  return {
    camera: [camera[0] + dx, camera[1], camera[2] + dz],
    target: [target[0] + dx, target[1], target[2] + dz],
  }
}
