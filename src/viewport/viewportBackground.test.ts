import { describe, expect, it } from 'vitest'
import { CAMERA_ICON_COLOR, CAMERA_ICON_SELECTED, GRID_FADE_DISTANCE, GRID_FADE_STRENGTH } from './viewportLook'
import {
  isShippedViewportBgDefault,
  mixHex,
  VIEWPORT_BG_CHARCOAL_DEFAULT,
  VIEWPORT_BG_DEFAULT_TOP,
  VIEWPORT_BG_FLOOR,
  VIEWPORT_BG_LEGACY_DEFAULT,
  viewportBgBottom,
  viewportBgMid,
} from './viewportBackground'

describe('viewportBgBottom', () => {
  it('pulls the default gray toward the charcoal floor', () => {
    const bottom = viewportBgBottom(VIEWPORT_BG_DEFAULT_TOP)
    const top = new ColorChannels(VIEWPORT_BG_DEFAULT_TOP)
    const floor = new ColorChannels(VIEWPORT_BG_FLOOR)
    const got = new ColorChannels(bottom)
    expect(got.luma).toBeLessThan(top.luma)
    expect(got.luma).toBeGreaterThan(floor.luma - 0.01)
  })

  it('keeps a large luma gap so the gradient reads as more than a black plate', () => {
    const top = new ColorChannels(VIEWPORT_BG_DEFAULT_TOP)
    const bottom = new ColorChannels(viewportBgBottom(VIEWPORT_BG_DEFAULT_TOP))
    expect(top.luma - bottom.luma).toBeGreaterThan(30)
  })

  it('places the mid stop between top and bottom', () => {
    const top = new ColorChannels(VIEWPORT_BG_DEFAULT_TOP)
    const mid = new ColorChannels(viewportBgMid(VIEWPORT_BG_DEFAULT_TOP))
    const bottom = new ColorChannels(viewportBgBottom(VIEWPORT_BG_DEFAULT_TOP))
    expect(mid.luma).toBeLessThan(top.luma)
    expect(mid.luma).toBeGreaterThan(bottom.luma)
  })

  it('mixHex keeps the endpoints', () => {
    expect(mixHex('#0f0f11', '#070708', 0)).toBe('#0f0f11')
    expect(mixHex('#0f0f11', '#070708', 1)).toBe('#070708')
  })

  it('treats the old near-black plate as a shipped default to migrate', () => {
    expect(isShippedViewportBgDefault(VIEWPORT_BG_CHARCOAL_DEFAULT)).toBe(true)
    expect(isShippedViewportBgDefault(VIEWPORT_BG_LEGACY_DEFAULT)).toBe(true)
    expect(isShippedViewportBgDefault(VIEWPORT_BG_DEFAULT_TOP)).toBe(false)
  })
})

describe('viewport camera glyph', () => {
  it('uses yellow so the frustum reads on the dark gradient', () => {
    const idle = new ColorChannels(CAMERA_ICON_COLOR)
    const selected = new ColorChannels(CAMERA_ICON_SELECTED)
    expect(idle.r).toBeGreaterThan(200)
    expect(idle.g).toBeGreaterThan(150)
    expect(idle.b).toBeLessThan(80)
    expect(selected.luma).toBeGreaterThan(idle.luma)
    expect(selected.r).toBeGreaterThan(240)
    expect(selected.g).toBeGreaterThan(220)
  })
})

describe('viewport grid fade', () => {
  it('falls off from the origin well inside a typical orbit', () => {
    expect(GRID_FADE_DISTANCE).toBeLessThanOrEqual(18)
    expect(GRID_FADE_STRENGTH).toBeGreaterThan(2)
  })
})

class ColorChannels {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly luma: number

  constructor(hex: string) {
    const n = parseInt(hex.slice(1), 16)
    this.r = (n >> 16) & 255
    this.g = (n >> 8) & 255
    this.b = n & 255
    this.luma = 0.2126 * this.r + 0.7152 * this.g + 0.0722 * this.b
  }
}
