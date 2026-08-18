import { describe, expect, it } from 'vitest'
import {
  aabbFromCenterSize,
  clientToCanvasPixels,
  horizontalDistanceSq,
  intersectRayAabb,
  intersectRayYPlane,
  type Ray3,
} from './pickMath'

describe('intersectRayYPlane', () => {
  it('hits a downward ray on y = planeY', () => {
    const ray: Ray3 = {
      origin: [1, 5, 2],
      direction: [0, -1, 0],
    }
    const hit = intersectRayYPlane(ray, 1.2)
    expect(hit).not.toBeNull()
    expect(hit!.t).toBeCloseTo(3.8)
    expect(hit!.point[0]).toBeCloseTo(1)
    expect(hit!.point[1]).toBeCloseTo(1.2)
    expect(hit!.point[2]).toBeCloseTo(2)
  })

  it('returns null for a parallel ray', () => {
    const ray: Ray3 = {
      origin: [0, 2, 0],
      direction: [1, 0, 0],
    }
    expect(intersectRayYPlane(ray, 0)).toBeNull()
  })

  it('returns null when the plane is behind the origin', () => {
    const ray: Ray3 = {
      origin: [0, 1, 0],
      direction: [0, 1, 0],
    }
    expect(intersectRayYPlane(ray, 0)).toBeNull()
  })
})

describe('intersectRayAabb', () => {
  const box = aabbFromCenterSize([0, 0.5, 0], [1, 1, 1])

  it('builds a centered AABB from size', () => {
    expect(box.min).toEqual([-0.5, 0, -0.5])
    expect(box.max).toEqual([0.5, 1, 0.5])
  })

  it('hits the front face of a unit box', () => {
    const ray: Ray3 = {
      origin: [0, 0.5, 3],
      direction: [0, 0, -1],
    }
    const hit = intersectRayAabb(ray, box)
    expect(hit).not.toBeNull()
    expect(hit!.t).toBeCloseTo(2.5)
    expect(hit!.point[2]).toBeCloseTo(0.5)
  })

  it('misses when the ray skims past', () => {
    const ray: Ray3 = {
      origin: [2, 0.5, 3],
      direction: [0, 0, -1],
    }
    expect(intersectRayAabb(ray, box)).toBeNull()
  })
})

describe('horizontalDistanceSq', () => {
  it('ignores Y', () => {
    expect(horizontalDistanceSq([0, 0, 0], [3, 99, 4])).toBeCloseTo(25)
  })
})

describe('clientToCanvasPixels', () => {
  it('maps client coords into the canvas box', () => {
    expect(
      clientToCanvasPixels(110, 220, { left: 100, top: 200, width: 400, height: 300 }),
    ).toEqual({ x: 10, y: 20 })
  })
})
