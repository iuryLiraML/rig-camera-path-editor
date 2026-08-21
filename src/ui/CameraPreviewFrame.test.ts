// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { clampPipRect } from './CameraPreviewFrame'
import { DIRECTOR_DOCK_WIDTH, GUTTER, viewportInsets } from './viewportInsets'

describe('clampPipRect', () => {
  it('keeps the PiP left of the Compose Director rail', () => {
    const vw = 1440
    const vh = 900
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: vw })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: vh })
    try {
      const insets = viewportInsets('compose', vw, true, vh, 240, {
        composeDock: 'timeline',
        showOutliner: true,
      })
      const clamped = clampPipRect({ right: 16, bottom: 16, fraction: 0.22 }, insets)
      expect(clamped.right).toBeGreaterThanOrEqual(GUTTER + DIRECTOR_DOCK_WIDTH + GUTTER)
      expect(clamped.bottom).toBeGreaterThanOrEqual(insets.contentBottom)
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
    }
  })
})
