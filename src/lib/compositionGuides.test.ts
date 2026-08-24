import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMPOSITION_GUIDES,
  GOLDEN_FAR,
  GOLDEN_NEAR,
  containRect,
  goldenLines,
  goldenRect,
  goldenSpiralArcs,
  goldenSpiralArcsForFrame,
  goldenSpiralPath,
  goldenSpiralPathFromFrameArcs,
  PHI,
  safeInsets,
  thirdsLines,
  toggleCompositionGuide,
} from './compositionGuides'

function dist(a: [number, number], b: [number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function inside(
  p: [number, number],
  r: { x: number; y: number; w: number; h: number },
  eps = 0.6,
) {
  return p[0] >= r.x - eps && p[0] <= r.x + r.w + eps && p[1] >= r.y - eps && p[1] <= r.y + r.h + eps
}

describe('compositionGuides', () => {
  it('defaults to thirds and safe area', () => {
    expect(DEFAULT_COMPOSITION_GUIDES).toEqual({
      thirds: true,
      golden: false,
      spiral: false,
      safe: true,
    })
  })

  it('places rule-of-thirds lines at 1/3 and 2/3', () => {
    expect(thirdsLines()).toEqual({ x: [1 / 3, 2 / 3], y: [1 / 3, 2 / 3] })
  })

  it('places golden-section lines at 1/φ² and 1/φ', () => {
    expect(GOLDEN_NEAR).toBeCloseTo(1 / (PHI * PHI))
    expect(GOLDEN_FAR).toBeCloseTo(1 / PHI)
    expect(goldenLines().x[0]).toBeCloseTo(GOLDEN_NEAR)
    expect(goldenLines().x[1]).toBeCloseTo(GOLDEN_FAR)
  })

  it('uses 5% action-safe and 10% title-safe breathing room', () => {
    expect(safeInsets()).toEqual({ action: 0.05, title: 0.1 })
  })

  it('toggles one guide without touching the others', () => {
    const next = toggleCompositionGuide(DEFAULT_COMPOSITION_GUIDES, 'golden')
    expect(next.golden).toBe(true)
    expect(next.thirds).toBe(true)
    expect(next.safe).toBe(true)
    expect(next.spiral).toBe(false)
  })

  it('fits a landscape golden rectangle to the frame height', () => {
    const rect = goldenRect(1920, 1080)
    expect(rect.h).toBe(1080)
    expect(rect.w / rect.h).toBeCloseTo(PHI)
    expect(rect.x).toBeGreaterThan(0)
    expect(rect.y).toBe(0)
  })

  it('fits a portrait golden rectangle to the frame width', () => {
    const rect = goldenRect(1080, 1920)
    expect(rect.w).toBe(1080)
    expect(rect.h / rect.w).toBeCloseTo(PHI)
    expect(rect.x).toBe(0)
    expect(rect.y).toBeGreaterThan(0)
  })

  it('letterboxes a 16:9 gate inside a wider look-through hole', () => {
    const gate = containRect(1600, 700, 16 / 9)
    expect(gate.h).toBe(700)
    expect(gate.w / gate.h).toBeCloseTo(16 / 9)
    expect(gate.x).toBeGreaterThan(0)
    expect(gate.y).toBe(0)
  })

  it('pillarboxes a 9:16 gate inside a landscape hole', () => {
    const gate = containRect(1600, 900, 9 / 16)
    expect(gate.w / gate.h).toBeCloseTo(9 / 16)
    expect(gate.y).toBe(0)
    expect(gate.x).toBeGreaterThan(0)
  })
})

describe('goldenSpiralArcs', () => {
  it('chains quarter-circles through whirling squares in a landscape φ rect', () => {
    const rect = goldenRect(1920, 1080)
    const arcs = goldenSpiralArcs(rect)
    expect(arcs.length).toBeGreaterThanOrEqual(6)

    for (let i = 0; i < arcs.length; i++) {
      const arc = arcs[i]
      expect(dist(arc.start, arc.end), `arc ${i} is not a quarter-circle`).toBeCloseTo(
        arc.radius * Math.SQRT2,
        0,
      )
      expect(inside(arc.start, rect)).toBe(true)
      expect(inside(arc.end, rect)).toBe(true)
      expect(inside(arc.start, arc.square)).toBe(true)
      expect(inside(arc.end, arc.square)).toBe(true)
      if (i > 0) {
        expect(dist(arc.start, arcs[i - 1].end), `arc ${i} is disconnected`).toBeLessThan(0.05)
        expect(arcs[i - 1].radius / arc.radius).toBeCloseTo(PHI, 1)
      }
    }

    const first = arcs[0]
    expect(first.square.x).toBeCloseTo(rect.x)
    expect(first.start[1]).toBeCloseTo(rect.y + rect.h)
    expect(first.end[0]).toBeCloseTo(rect.x + first.radius)
  })

  it('starts from the top square in a portrait φ rect', () => {
    const rect = goldenRect(1080, 1920)
    const arcs = goldenSpiralArcs(rect)
    expect(arcs[0].square.y).toBeCloseTo(rect.y)
    expect(arcs[0].start[1]).toBeCloseTo(rect.y)
    expect(dist(arcs[1].start, arcs[0].end)).toBeLessThan(0.05)
  })

  it('emits a single continuous SVG path', () => {
    const path = goldenSpiralPath(goldenRect(1920, 1080))
    expect(path.startsWith('M ')).toBe(true)
    expect(path.match(/ A /g)?.length).toBeGreaterThanOrEqual(6)
    expect(path.indexOf('M ', 1)).toBe(-1)
  })
})

describe('goldenSpiralArcsForFrame', () => {
  it('scales the φ spiral onto a 16:9 gate from the frame corner', () => {
    const gate = { x: 0, y: 0, w: 1920, h: 1080 }
    const arcs = goldenSpiralArcsForFrame(gate.w, gate.h)
    expect(arcs.length).toBeGreaterThanOrEqual(6)
    expect(arcs[0].start[0]).toBeCloseTo(0)
    expect(arcs[0].start[1]).toBeCloseTo(1080)
    expect(arcs[0].end[0]).toBeCloseTo(1920 / PHI)
    expect(arcs[0].end[1]).toBeCloseTo(0)
    for (let i = 0; i < arcs.length; i++) {
      expect(inside(arcs[i].start, gate)).toBe(true)
      expect(inside(arcs[i].end, gate)).toBe(true)
      if (i > 0) {
        expect(dist(arcs[i].start, arcs[i - 1].end), `arc ${i} is disconnected`).toBeLessThan(0.05)
      }
    }
    const path = goldenSpiralPathFromFrameArcs(arcs)
    expect(path.startsWith('M 0.00 1080.00')).toBe(true)
    expect(path).toContain(' A ')
  })

  it('scales the φ spiral onto a 9:16 gate from the top-left corner', () => {
    const gate = { x: 0, y: 0, w: 1080, h: 1920 }
    const arcs = goldenSpiralArcsForFrame(gate.w, gate.h)
    expect(arcs[0].start[0]).toBeCloseTo(0)
    expect(arcs[0].start[1]).toBeCloseTo(0)
    expect(arcs[0].end[0]).toBeCloseTo(1080)
    expect(arcs[0].end[1]).toBeCloseTo(1920 / PHI)
    expect(dist(arcs[1].start, arcs[0].end)).toBeLessThan(0.05)
  })
})
