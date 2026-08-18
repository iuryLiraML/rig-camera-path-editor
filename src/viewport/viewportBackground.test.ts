import { describe, expect, it } from 'vitest'
import {
  mixHex,
  VIEWPORT_BG_DEFAULT_TOP,
  VIEWPORT_BG_FLOOR,
  viewportBgBottom,
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

  it('mixHex keeps the endpoints', () => {
    expect(mixHex('#0f0f11', '#070708', 0)).toBe('#0f0f11')
    expect(mixHex('#0f0f11', '#070708', 1)).toBe('#070708')
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
