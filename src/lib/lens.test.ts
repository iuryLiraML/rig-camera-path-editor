import { describe, expect, it } from 'vitest'
import { fovFromFocalLength, focalLengthFromFov, nearestLensPreset } from './lens'

describe('lens', () => {
  it('round-trips focal length through vertical FOV', () => {
    const fov = fovFromFocalLength(35)
    expect(focalLengthFromFov(fov)).toBeCloseTo(35, 5)
  })

  it('maps 35mm to the nearest preset from a ~40° FOV', () => {
    expect(nearestLensPreset(fovFromFocalLength(35))).toBe(35)
    expect(nearestLensPreset(fovFromFocalLength(24))).toBe(24)
  })

  it('a wider lens produces a larger FOV', () => {
    expect(fovFromFocalLength(14)).toBeGreaterThan(fovFromFocalLength(200))
  })
})
