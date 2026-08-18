import { describe, expect, it } from 'vitest'
import { easeDef } from './easing'
import {
  cubicSegmentPath,
  cssBezierHandles,
  pointerToCssBezier,
  rangeWithHandles,
} from './graphSpline'
import { RANGE_PROGRESS, valueToGraphY, valueToLaneY } from './lanePlot'

describe('cssBezierHandles', () => {
  it('maps linear handles onto the segment endpoints’ thirds', () => {
    const [p1, p2] = cssBezierHandles(0, 1, 0, 10, [0, 0, 1, 1])
    expect(p1.t).toBeCloseTo(0)
    expect(p1.v).toBeCloseTo(0)
    expect(p2.t).toBeCloseTo(1)
    expect(p2.v).toBeCloseTo(10)
  })

  it('places Quart In-Out handles on the geometric cubic, not a sampled polyline', () => {
    const bezier = easeDef('quartInOut').bezier
    const [p1, p2] = cssBezierHandles(0, 1, 0, 1, bezier)
    expect(p1.t).toBeCloseTo(0.77)
    expect(p1.v).toBeCloseTo(0)
    expect(p2.t).toBeCloseTo(0.175)
    expect(p2.v).toBeCloseTo(1)
  })

  it('round-trips a dragged handle through CSS bezier space', () => {
    const start: [number, number, number, number] = [0.25, 0, 0.75, 1]
    const next = pointerToCssBezier(1, 0.4, 2, 0, 1, 0, 10, start)
    expect(next[0]).toBeCloseTo(0.4)
    expect(next[1]).toBeCloseTo(0.2)
    expect(next[2]).toBe(0.75)
    const [p1] = cssBezierHandles(0, 1, 0, 10, next)
    expect(p1.t).toBeCloseTo(0.4)
    expect(p1.v).toBeCloseTo(2)
  })

  it('allows overshoot past the keys (Back / pulled tangents)', () => {
    const next = pointerToCssBezier(2, 0.8, 14, 0, 1, 0, 10, [0.25, 0, 0.75, 1])
    expect(next[3]).toBeCloseTo(1.4)
    const [, p2] = cssBezierHandles(0, 1, 0, 10, next)
    expect(p2.v).toBeCloseTo(14)
  })

  it('emits an SVG cubic whose control points match the handles', () => {
    const bezier: [number, number, number, number] = [0.5, 0, 0.5, 1]
    const d = cubicSegmentPath(0, 1, 0, 1, bezier, RANGE_PROGRESS)
    expect(d).toMatch(/^M /)
    expect(d).toContain(' C ')
    const [p1, p2] = cssBezierHandles(0, 1, 0, 1, bezier)
    expect(d).toContain(String(p1.t * 100))
    expect(d).toContain(String(p2.t * 100))
  })
})

describe('rangeWithHandles', () => {
  it('widens the range so a Back Out handle is not clipped', () => {
    const bezier = easeDef('backOut').bezier
    const range = rangeWithHandles(
      RANGE_PROGRESS,
      [
        { time: 0, value: 0, easeBezier: bezier },
        { time: 1, value: 1 },
      ],
      'linear',
    )
    expect(range.hi).toBeGreaterThan(1)
  })
})

describe('valueToGraphY', () => {
  it('does not clip overshoot the way the lane plot does', () => {
    expect(valueToLaneY(1.4, RANGE_PROGRESS)).toBe(valueToLaneY(1, RANGE_PROGRESS))
    expect(valueToGraphY(1.4, RANGE_PROGRESS)).toBeLessThan(valueToGraphY(1, RANGE_PROGRESS))
  })
})
