import { describe, expect, it } from 'vitest'
import { applyEase, easeCss, easeForSmoothness, EASES, easeGroups, DEFAULT_EASE } from './easing'

describe('easing', () => {
  it('pins both ends of every curve', () => {
    for (const ease of EASES) {
      expect(applyEase(ease.kind, 0), ease.label).toBe(0)
      expect(applyEase(ease.kind, 1), ease.label).toBe(1)
    }
  })

  it('is the identity for linear', () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(applyEase('linear', t)).toBeCloseTo(t, 6)
    }
  })

  it('solves the bezier as accurately as a brute-force sweep', () => {
    // independent reference: walk the parametric curve, take the y whose x is
    // closest to the requested time. The Newton-Raphson solver must agree.
    const reference = (bezier: [number, number, number, number], t: number) => {
      const [x1, y1, x2, y2] = bezier
      const at = (u: number, a: number, b: number) =>
        3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u
      let best = 0
      let bestErr = Infinity
      for (let i = 0; i <= 200000; i++) {
        const u = i / 200000
        const err = Math.abs(at(u, x1, x2) - t)
        if (err < bestErr) {
          bestErr = err
          best = at(u, y1, y2)
        }
      }
      return best
    }
    for (const kind of ['cubicOut', 'expoInOut', 'backOut', 'circIn'] as const) {
      const def = EASES.find((e) => e.kind === kind)!
      for (const t of [0.15, 0.4, 0.62, 0.88]) {
        expect(applyEase(kind, t), `${kind} at ${t}`).toBeCloseTo(reference(def.bezier, t), 4)
      }
    }
  })

  it('is symmetric where the control points are', () => {
    // expo in-out is (1,0,0,1) — an exact mirror around (0.5, 0.5)
    expect(applyEase('expoInOut', 0.5)).toBeCloseTo(0.5, 6)
    // the published Penner approximations are NOT exact mirrors — sine is close
    // (0.503) while quart is deliberately weighted (0.596), so don't assert a
    // midpoint on them, only that they stay inside the unit square
    for (const kind of ['sineInOut', 'quartInOut', 'quintInOut'] as const) {
      const mid = applyEase(kind, 0.5)
      expect(mid, kind).toBeGreaterThan(0)
      expect(mid, kind).toBeLessThan(1)
    }
    expect(applyEase('sineInOut', 0.5)).toBeCloseTo(0.5, 2)
  })

  it('decelerates on ease-out and accelerates on ease-in', () => {
    // ease-out covers more ground early; ease-in lags then catches up
    expect(applyEase('cubicOut', 0.25)).toBeGreaterThan(0.25)
    expect(applyEase('cubicIn', 0.25)).toBeLessThan(0.25)
    // stronger family, stronger effect at the same time
    expect(applyEase('expoOut', 0.25)).toBeGreaterThan(applyEase('sineOut', 0.25))
  })

  it('overshoots only on the Back family', () => {
    const peak = (kind: Parameters<typeof applyEase>[0]) =>
      Math.max(...Array.from({ length: 99 }, (_, i) => applyEase(kind, (i + 1) / 100)))
    expect(peak('backOut')).toBeGreaterThan(1)
    expect(peak('quartInOut')).toBeLessThanOrEqual(1.0001)
    expect(peak('expoOut')).toBeLessThanOrEqual(1.0001)
  })

  it('stays monotonic through time for the non-overshooting curves', () => {
    for (const ease of EASES.filter((e) => !e.kind.startsWith('back'))) {
      let prev = -1
      for (let i = 0; i <= 40; i++) {
        const v = applyEase(ease.kind, i / 40)
        expect(v, `${ease.label} at ${i / 40}`).toBeGreaterThanOrEqual(prev - 1e-6)
        prev = v
      }
    }
  })

  it('maps the retired smoothness slider onto the nearest curve', () => {
    // saved projects, shots, the agent tool and the drone-camera generator all
    // still speak in 0..1 smoothness
    expect(easeForSmoothness(0)).toBe('linear')
    expect(easeForSmoothness(0.05)).toBe('linear')
    expect(easeForSmoothness(0.2)).toBe('sineInOut')
    expect(easeForSmoothness(0.5)).toBe('cubicInOut')
    expect(easeForSmoothness(0.6)).toBe('quartInOut')
    expect(easeForSmoothness(1)).toBe('quintInOut')
    // out of range input is clamped, not passed through
    expect(easeForSmoothness(-5)).toBe('linear')
    expect(easeForSmoothness(99)).toBe('quintInOut')
  })

  it('exposes every preset through the grouped picker exactly once', () => {
    const grouped = easeGroups().flatMap((g) => g.items)
    expect(grouped).toHaveLength(EASES.length)
    expect(new Set(grouped.map((e) => e.kind)).size).toBe(EASES.length)
    expect(EASES.some((e) => e.kind === DEFAULT_EASE)).toBe(true)
  })

  it('writes the curve the way the rest of the industry does', () => {
    expect(easeCss('expoInOut')).toBe('cubic-bezier(1, 0, 0, 1)')
    expect(easeCss('cubicOut')).toBe('cubic-bezier(0.215, 0.61, 0.355, 1)')
  })
})
