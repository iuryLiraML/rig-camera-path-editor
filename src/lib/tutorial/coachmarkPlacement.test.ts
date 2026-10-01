import { describe, expect, it } from 'vitest'
import { clamp, placePopover, sameRect } from './coachmarkPlacement'
import { TUTORIAL_ANCHORS } from './anchors'
import { TUTORIAL_STEPS } from './steps'

const SAFE = { top: 0, right: 0, bottom: 0, left: 0 }
const POP = { w: 320, h: 160 }

describe('placePopover', () => {
  it('uses the preferred side when it fits', () => {
    const p = placePopover({ left: 100, top: 50, width: 40, height: 40 }, POP, 'bottom', SAFE, 1200, 800)
    expect(p.fits).toBe(true)
    expect(p.side).toBe('bottom')
    expect(p.top).toBe(50 + 40 + 12)
  })

  it('falls to another side when the preferred one has no room', () => {
    // Target hugging the bottom edge — no room below, so it flips to top.
    const p = placePopover({ left: 600, top: 770, width: 40, height: 20 }, POP, 'bottom', SAFE, 1200, 800)
    expect(p.fits).toBe(true)
    expect(p.side).toBe('top')
  })

  it('reports fits=false when no side has room (caller renders a centered card)', () => {
    const p = placePopover({ left: 80, top: 80, width: 40, height: 40 }, POP, 'bottom', SAFE, 200, 200)
    expect(p.fits).toBe(false) // spec: never overlap the control's side — center instead
  })

  it('clamps the popover inside the viewport and safe area', () => {
    const p = placePopover({ left: 1150, top: 50, width: 40, height: 40 }, POP, 'bottom', SAFE, 1200, 800)
    expect(p.side).toBe('bottom')
    // left would be cx - w/2 = 1170 - 160 = 1010, clamped to 1200 - 12 - 320 = 868
    expect(p.left).toBe(868)
    expect(p.left + POP.w).toBeLessThanOrEqual(1200 - 12)
  })

  it('respects the safe area on the clamped edges', () => {
    const safe = { top: 40, right: 30, bottom: 34, left: 20 }
    const p = placePopover({ left: 0, top: 0, width: 20, height: 20 }, POP, 'top', safe, 400, 400)
    expect(p.left).toBeGreaterThanOrEqual(12 + safe.left)
    expect(p.top).toBeGreaterThanOrEqual(12 + safe.top)
  })

  it('keeps the arrow within the popover bounds, pointing at the control', () => {
    const p = placePopover({ left: 1150, top: 50, width: 40, height: 40 }, POP, 'bottom', SAFE, 1200, 800)
    expect(p.arrowLeft).toBeGreaterThanOrEqual(16)
    expect(p.arrowLeft).toBeLessThanOrEqual(POP.w - 16)
  })
})

describe('clamp / sameRect', () => {
  it('clamps within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
    expect(clamp(5, 10, 0)).toBe(10) // hi < lo guarded
  })

  it('compares rects by value', () => {
    const a = { left: 1, top: 2, width: 3, height: 4 }
    expect(sameRect(a, { ...a })).toBe(true)
    expect(sameRect(a, { ...a, left: 9 })).toBe(false)
    expect(sameRect(null, null)).toBe(true)
    expect(sameRect(a, null)).toBe(false)
  })
})

describe('tutorial anchors', () => {
  it('has an anchor for every step; welcome is centered, others target a control', () => {
    for (const step of TUTORIAL_STEPS) {
      const anchor = TUTORIAL_ANCHORS[step.id]
      expect(anchor, step.id).toBeDefined()
      expect(typeof anchor.setup).toBe('function')
      if (step.id === 'welcome') {
        expect(anchor.selector).toBeNull()
        expect(anchor.placement).toBe('center')
      } else {
        expect(anchor.selector, step.id).toBeTruthy()
        expect(anchor.placement).not.toBe('center')
      }
    }
  })
})
