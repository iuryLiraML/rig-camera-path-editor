import { describe, expect, it } from 'vitest'
import { freeAreaRect, GUTTER, viewportInsets } from './viewportInsets'
import { TIMELINE_HEIGHT } from './Timeline'

/**
 * The floating chrome used to hard-code its own offsets (left-[244px],
 * right-[252px], right-[332px], pipRect.right: 264). They disagreed with each
 * other and with the right panel, whose width changes with its tab, so the
 * timeline ended up 80 px short of the panel in one tab and would be covered by
 * it in the other. These assertions pin the geometry to the real panel widths.
 */
const WINDOW = 1202
const LEFT_PANEL_RIGHT_EDGE = GUTTER + 232 // left-3 + w-[232px]
const RIGHT_PANEL_WIDTHS = { design: 240, assistant: 320 }

describe('viewportInsets', () => {
  it('leaves a gutter after the left panel instead of sitting flush against it', () => {
    const insets = viewportInsets('design', WINDOW, true)
    expect(insets.left).toBe(LEFT_PANEL_RIGHT_EDGE + GUTTER)
    expect(insets.left).toBeGreaterThan(LEFT_PANEL_RIGHT_EDGE)
  })

  for (const tab of ['design', 'assistant'] as const) {
    it(`stops a gutter before the right panel in the ${tab} tab`, () => {
      const insets = viewportInsets(tab, WINDOW, true)
      const panelLeftEdge = WINDOW - GUTTER - RIGHT_PANEL_WIDTHS[tab]
      // never under the panel, and never leaving a dead strip wider than the gutter
      expect(insets.right).toBe(panelLeftEdge - GUTTER)
      expect(panelLeftEdge - insets.right).toBe(GUTTER)
    })
  }

  it('tracks the panel when the tab changes', () => {
    const design = viewportInsets('design', WINDOW, true)
    const assistant = viewportInsets('assistant', WINDOW, true)
    // the assistant panel is 80 px wider, so the free area must shrink by 80 px
    expect(design.right - assistant.right).toBe(
      RIGHT_PANEL_WIDTHS.assistant - RIGHT_PANEL_WIDTHS.design,
    )
  })

  it('centres on the free area, not on the window', () => {
    const insets = viewportInsets('design', WINDOW, true)
    expect(insets.centre).toBe(insets.left + (insets.right - insets.left) / 2)
    // the old bug: centring on the window pushed the footer past the timeline
    expect(insets.centre).not.toBe(WINDOW / 2)
  })

  it('reserves the timeline height only while the dock is up', () => {
    expect(viewportInsets('design', WINDOW, true).bottom).toBe(GUTTER + TIMELINE_HEIGHT + GUTTER)
    expect(viewportInsets('design', WINDOW, false).bottom).toBe(GUTTER)
  })

  it('keeps the default PiP offset inside the free area', () => {
    const insets = viewportInsets('design', WINDOW, true)
    // 264 is the shipped default: it must equal the minimum allowed `right`
    expect(WINDOW - insets.right).toBe(264)
  })

  it('reserves the top row, so pane chrome cannot land under the Toolbar', () => {
    const insets = viewportInsets('design', WINDOW, true)
    // the Toolbar sits at top-3 and is 38 px tall, over the area layer
    expect(insets.top).toBe(GUTTER + 38 + GUTTER)
    // the split placed its controls at the pane corner + 6 px — measurably
    // under the Toolbar, which made the only "close pane" button unclickable
    expect(insets.top).toBeGreaterThan(6)
  })

  it('describes the free area as a rect for overlay chrome', () => {
    const insets = viewportInsets('design', WINDOW, true)
    const free = freeAreaRect(insets, 873)
    expect(free).toEqual({
      x: insets.left,
      y: insets.top,
      w: insets.right - insets.left,
      h: 873 - insets.bottom - insets.top,
    })
    expect(free.w).toBeGreaterThan(0)
    expect(free.h).toBeGreaterThan(0)
  })

  it('reserves room for the footer row above the timeline', () => {
    const insets = viewportInsets('design', WINDOW, true)
    // floating content (the PiP) must start above the footer, not on top of it
    expect(insets.contentBottom).toBeGreaterThan(insets.bottom + GUTTER)
    // the shipped PiP default (192) sat inside the footer band — it must not pass
    expect(insets.contentBottom).toBeGreaterThan(192)
  })
})
