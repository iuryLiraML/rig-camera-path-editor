import type { Vec3 } from '../state/useSceneStore'

/** Infinite ray in world space (direction should be unit length). */
export type Ray3 = {
  origin: Vec3
  direction: Vec3
}

export type Aabb3 = {
  min: Vec3
  max: Vec3
}

export type RayHit = {
  point: Vec3
  /** Distance along the ray from the origin (world units when direction is unit). */
  t: number
}

const EPS = 1e-8

/** Canonical Y-up drawing plane: y = planeY. */
export function intersectRayYPlane(ray: Ray3, planeY: number): RayHit | null {
  const dy = ray.direction[1]
  if (Math.abs(dy) < EPS) return null
  const t = (planeY - ray.origin[1]) / dy
  if (t < 0) return null
  return {
    t,
    point: [
      ray.origin[0] + ray.direction[0] * t,
      planeY,
      ray.origin[2] + ray.direction[2] * t,
    ],
  }
}

/**
 * Slab-method ray/AABB intersection. Returns the nearest hit in front of the
 * origin (`t ≥ 0`), or null if there is no intersection.
 */
export function intersectRayAabb(ray: Ray3, aabb: Aabb3): RayHit | null {
  let tMin = 0
  let tMax = Number.POSITIVE_INFINITY

  for (let axis = 0; axis < 3; axis++) {
    const o = ray.origin[axis]
    const d = ray.direction[axis]
    const min = aabb.min[axis]
    const max = aabb.max[axis]

    if (Math.abs(d) < EPS) {
      if (o < min || o > max) return null
      continue
    }

    let t1 = (min - o) / d
    let t2 = (max - o) / d
    if (t1 > t2) {
      const swap = t1
      t1 = t2
      t2 = swap
    }
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return null
  }

  const t = tMin >= 0 ? tMin : tMax
  if (t < 0 || !Number.isFinite(t)) return null
  return {
    t,
    point: [
      ray.origin[0] + ray.direction[0] * t,
      ray.origin[1] + ray.direction[1] * t,
      ray.origin[2] + ray.direction[2] * t,
    ],
  }
}

/** Axis-aligned box from center + half extents (PlayCanvas unit box * local scale / 2). */
export function aabbFromCenterSize(center: Vec3, size: Vec3): Aabb3 {
  const hx = Math.abs(size[0]) * 0.5
  const hy = Math.abs(size[1]) * 0.5
  const hz = Math.abs(size[2]) * 0.5
  return {
    min: [center[0] - hx, center[1] - hy, center[2] - hz],
    max: [center[0] + hx, center[1] + hy, center[2] + hz],
  }
}

/** Squared horizontal (XZ) distance — useful for snapping anchors on the draw plane. */
export function horizontalDistanceSq(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0]
  const dz = a[2] - b[2]
  return dx * dx + dz * dz
}

/**
 * Client coordinates → canvas pixel coordinates expected by PlayCanvas
 * `CameraComponent.screenToWorld` (origin top-left of the canvas element).
 */
export function clientToCanvasPixels(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const w = Math.max(1, rect.width)
  const h = Math.max(1, rect.height)
  return {
    x: ((clientX - rect.left) / w) * w,
    y: ((clientY - rect.top) / h) * h,
  }
}
