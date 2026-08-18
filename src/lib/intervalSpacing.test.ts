import { describe, expect, it } from 'vitest'
import {
  applySpacing,
  DEFAULT_SPACING,
  inHandleU,
  outHandleU,
  uToInW,
  uToOutW,
} from './intervalSpacing'

describe('applySpacing', () => {
  it('is the identity at the default weights', () => {
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      expect(applySpacing(u, DEFAULT_SPACING, DEFAULT_SPACING)).toBeCloseTo(u, 8)
    }
  })

  it('clamps outside 0..1', () => {
    expect(applySpacing(-1)).toBe(0)
    expect(applySpacing(2)).toBe(1)
  })

  it('lingers at the start when outW is low (midpoint stays behind linear)', () => {
    expect(applySpacing(0.5, 0, 0.5)).toBeLessThan(0.5)
  })

  it('lingers at the end when inW is low (midpoint is already ahead)', () => {
    expect(applySpacing(0.5, 0.5, 0)).toBeGreaterThan(0.5)
  })

  it('does not change the keyed endpoints', () => {
    expect(applySpacing(0, 0, 0)).toBe(0)
    expect(applySpacing(1, 0, 0)).toBe(1)
    expect(applySpacing(0, 1, 1)).toBe(0)
    expect(applySpacing(1, 1, 1)).toBe(1)
  })
})

describe('handle mapping', () => {
  it('puts default weights at a quarter and three-quarters of the interval', () => {
    expect(outHandleU(0.5)).toBeCloseTo(0.25, 2)
    expect(inHandleU(0.5)).toBeCloseTo(0.75, 2)
  })

  it('round-trips handle position back to the weight', () => {
    for (const w of [0, 0.25, 0.5, 0.75, 1]) {
      expect(uToOutW(outHandleU(w))).toBeCloseTo(w, 5)
      expect(uToInW(inHandleU(w))).toBeCloseTo(w, 5)
    }
  })

  it('moves the outgoing handle toward the left key when lingering', () => {
    expect(outHandleU(0)).toBeLessThan(outHandleU(0.5))
  })

  it('moves the incoming handle toward the right key when lingering', () => {
    expect(inHandleU(0)).toBeGreaterThan(inHandleU(0.5))
  })
})
