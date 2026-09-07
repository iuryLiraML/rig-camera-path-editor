import { describe, expect, it } from 'vitest'
import { cssPointFromClient, eventShiftHeld, ndcFromPane } from './pointerNdc'

describe('cssPointFromClient', () => {
  const canvas = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100, right: 210, bottom: 120, x: 10, y: 20, toJSON: () => ({}) }),
  }

  it('uses clientX/Y minus the canvas box, not offsetX/offsetY', () => {
    const p = cssPointFromClient(60, 70, canvas)
    expect(p).toEqual({ x: 50, y: 50, width: 200, height: 100 })
  })

  it('returns the same CSS point even when a Safari-like offsetX disagrees', () => {
    const safariOffsetX = 12
    const fromClient = cssPointFromClient(60, 70, canvas)
    expect(fromClient?.x).not.toBe(safariOffsetX)
    expect(fromClient?.x).toBe(50)
  })

  it('rejects points outside the canvas', () => {
    expect(cssPointFromClient(0, 70, canvas)).toBeNull()
    expect(cssPointFromClient(60, 0, canvas)).toBeNull()
  })
})

describe('eventShiftHeld', () => {
  it('reads nativeEvent.shiftKey when the R3F synthetic event drops it', () => {
    expect(eventShiftHeld({ shiftKey: false, nativeEvent: { shiftKey: true } })).toBe(true)
    expect(eventShiftHeld({ shiftKey: false, nativeEvent: { shiftKey: false } })).toBe(false)
    expect(eventShiftHeld({ shiftKey: true, nativeEvent: { shiftKey: false } })).toBe(true)
  })
})

describe('ndcFromPane', () => {
  it('maps pane-local CSS pixels into NDC', () => {
    const ndc = ndcFromPane(50, 25, { x: 0, y: 0, w: 100, h: 50 })
    expect(ndc.x).toBe(0)
    expect(ndc.y).toBe(0)
  })
})
