import * as THREE from 'three'
import type { Vec3 } from '../../state/useSceneStore'

export type Aabb = {
  min: Vec3
  max: Vec3
  center: Vec3
  size: Vec3
  diagonal: number
}

export function aabbFromCenterSize(center: Vec3, size: Vec3): Aabb {
  const half: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2]
  const min: Vec3 = [center[0] - half[0], center[1] - half[1], center[2] - half[2]]
  const max: Vec3 = [center[0] + half[0], center[1] + half[1], center[2] + half[2]]
  const diagonal = Math.hypot(size[0], size[1], size[2])
  return { min, max, center, size, diagonal }
}

export function aabbCorners(box: Aabb): Vec3[] {
  const [x0, y0, z0] = box.min
  const [x1, y1, z1] = box.max
  return [
    [x0, y0, z0],
    [x1, y0, z0],
    [x0, y1, z0],
    [x1, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x0, y1, z1],
    [x1, y1, z1],
  ]
}

/** Point-in-AABB with a small outward margin so grazing the surface still counts as inside. */
export function pointInsideAabb(point: Vec3, box: Aabb, margin = 0.02): boolean {
  return (
    point[0] >= box.min[0] - margin &&
    point[0] <= box.max[0] + margin &&
    point[1] >= box.min[1] - margin &&
    point[1] <= box.max[1] + margin &&
    point[2] >= box.min[2] - margin &&
    point[2] <= box.max[2] + margin
  )
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** Median / max distance from subject center to path samples. */
export function pathRadiusStats(samples: Vec3[], center: Vec3): { median: number; max: number } {
  if (samples.length === 0) return { median: 0, max: 0 }
  const distances = samples.map((p) => distance(p, center)).sort((a, b) => a - b)
  const mid = Math.floor(distances.length / 2)
  const median =
    distances.length % 2 === 0 ? (distances[mid - 1] + distances[mid]) / 2 : distances[mid]
  return { median, max: distances[distances.length - 1] }
}

/**
 * Projected AABB fill as a percent of the frame (0–100).
 * NDC full-frame area is 2×2 = 4; clamped projected width×height / 4.
 * Returns 0 when the box is entirely behind the camera.
 */
export function projectedFillPercent(
  box: Aabb,
  cameraPosition: Vec3,
  lookTarget: Vec3,
  fovDeg: number,
  aspect: number,
  rollDeg = 0,
): number {
  const camera = new THREE.PerspectiveCamera(fovDeg, aspect, 0.05, 500)
  camera.position.set(...cameraPosition)
  camera.up.set(0, 1, 0)
  camera.lookAt(lookTarget[0], lookTarget[1], lookTarget[2])
  if (Math.abs(rollDeg) > 1e-4) {
    camera.rotateZ(THREE.MathUtils.degToRad(rollDeg))
  }
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let inFront = 0
  const ndc = new THREE.Vector3()
  for (const corner of aabbCorners(box)) {
    ndc.set(...corner).project(camera)
    if (ndc.z < 1) inFront++
    minX = Math.min(minX, ndc.x)
    maxX = Math.max(maxX, ndc.x)
    minY = Math.min(minY, ndc.y)
    maxY = Math.max(maxY, ndc.y)
  }
  if (inFront === 0) return 0

  const width = Math.max(0, Math.min(1, maxX) - Math.max(-1, minX))
  const height = Math.max(0, Math.min(1, maxY) - Math.max(-1, minY))
  return Math.min(100, Math.max(0, ((width * height) / 4) * 100))
}

export function aspectFromExport(aspect: '16:9' | '1:1' | '9:16'): number {
  switch (aspect) {
    case '16:9':
      return 16 / 9
    case '1:1':
      return 1
    case '9:16':
      return 9 / 16
    default: {
      const _never: never = aspect
      return _never
    }
  }
}
