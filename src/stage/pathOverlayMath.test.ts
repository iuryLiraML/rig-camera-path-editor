import { describe, expect, it } from 'vitest'
import { makeAnchor } from '../state/usePathStore'
import {
  DEFAULT_SHOT_DURATION_S,
  clampShotDuration,
  samplePathPolyline,
  warmPathSampleCount,
} from './pathOverlayMath'

describe('clampShotDuration', () => {
  it('clamps into 1..30 and defaults non-finite', () => {
    expect(clampShotDuration(6)).toBe(6)
    expect(clampShotDuration(0)).toBe(1)
    expect(clampShotDuration(100)).toBe(30)
    expect(clampShotDuration(Number.NaN)).toBe(DEFAULT_SHOT_DURATION_S)
  })
})

describe('samplePathPolyline', () => {
  it('returns empty / single / corners before a curve exists', () => {
    expect(samplePathPolyline({ anchors: [] })).toEqual([])
    const a = makeAnchor([0, 0, 0])
    expect(samplePathPolyline({ anchors: [a] })).toEqual([[0, 0, 0]])
  })

  it('samples a curve denser than the corner count', () => {
    const anchors = [
      makeAnchor([0, 0, 0]),
      makeAnchor([2, 0, 0]),
      makeAnchor([2, 0, 2]),
    ]
    const poly = samplePathPolyline({ anchors, closed: false, rounding: 0.8 })
    expect(poly.length).toBeGreaterThan(anchors.length)
    expect(poly[0]).toEqual([0, 0, 0])
    const last = poly[poly.length - 1]!
    expect(last[0]).toBeCloseTo(2, 5)
    expect(last[2]).toBeCloseTo(2, 5)
  })
})

describe('warmPathSampleCount', () => {
  it('keeps the 6s default at 9 and densifies longer shots', () => {
    expect(warmPathSampleCount(6)).toBe(9)
    expect(warmPathSampleCount(12)).toBe(18)
    expect(warmPathSampleCount(30)).toBe(25)
    expect(warmPathSampleCount(1)).toBe(9)
  })
})
