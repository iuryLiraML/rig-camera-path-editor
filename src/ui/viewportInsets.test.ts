import { describe, expect, it } from 'vitest'
import {
  chromeBand,
  DIRECTOR_COMPOSER_HEIGHT,
  DIRECTOR_DOCK_WIDTH,
  directorDockSlot,
  FOOTER_ROW_HEIGHT,
  freeAreaRect,
  GUTTER,
  LEFT_PANEL_MAX,
  SEQUENCE_HEIGHT,
  toolbarSlot,
  viewportInsets,
} from './viewportInsets'
import { TIMELINE_HEIGHT } from './Timeline'

const WINDOW = 1202

describe('viewportInsets', () => {
  it('Build leaves the canvas full-bleed when the outliner is closed', () => {
    const insets = viewportInsets('build', WINDOW, false)
    expect(insets.leftWidth).toBe(0)
    expect(insets.rightWidth).toBe(0)
    expect(insets.left).toBe(GUTTER)
    expect(insets.right).toBe(WINDOW - GUTTER)
    expect(insets.bottom).toBe(GUTTER)
  })

  it('Build reserves the outliner when it is open', () => {
    const insets = viewportInsets('build', WINDOW, false, 900, 240, { showOutliner: true })
    expect(insets.leftWidth).toBe(LEFT_PANEL_MAX)
    expect(insets.left).toBe(GUTTER + LEFT_PANEL_MAX + GUTTER)
  })

  it('Compose Sequence uses the short shot strip, not the AE dock', () => {
    const insets = viewportInsets('compose', WINDOW, true, 900, 240, { composeDock: 'sequence' })
    expect(insets.timelineHeight).toBe(SEQUENCE_HEIGHT)
    expect(insets.bottom).toBe(GUTTER + SEQUENCE_HEIGHT + GUTTER)
    expect(insets.leftWidth).toBe(0)
    expect(insets.rightWidth).toBe(DIRECTOR_DOCK_WIDTH)
  })

  it('Compose Timeline reserves the requested AE dock height', () => {
    const insets = viewportInsets('compose', WINDOW, true, 900, TIMELINE_HEIGHT, {
      composeDock: 'timeline',
    })
    expect(insets.timelineHeight).toBe(TIMELINE_HEIGHT)
    expect(insets.bottom).toBe(GUTTER + TIMELINE_HEIGHT + GUTTER)
  })

  it('hides the compose dock while the bottom is not visible', () => {
    expect(viewportInsets('compose', WINDOW, false, 900, 240, { composeDock: 'timeline' }).bottom).toBe(
      GUTTER,
    )
  })

  it('pins the Director column to the right of the free area', () => {
    const insets = viewportInsets('build', WINDOW, false)
    const slot = directorDockSlot(insets)
    expect(slot.right).toBe(GUTTER)
    expect(slot.width).toBe(DIRECTOR_DOCK_WIDTH)
    const dockLeft = WINDOW - slot.right - slot.width
    expect(dockLeft).toBeGreaterThan(insets.centre)
  })

  it('Visualize is full-bleed — Director floats on the right instead of a reserved rail', () => {
    const insets = viewportInsets('visualize', WINDOW, false)
    expect(insets.rightWidth).toBe(0)
    expect(insets.right).toBe(WINDOW - GUTTER)
    expect(insets.leftWidth).toBe(0)
    expect(insets.dockBottom).toBe(GUTTER + GUTTER)
  })

  it('centres on the free area, not on the window, when the outliner is open', () => {
    const insets = viewportInsets('build', WINDOW, false, 900, 240, { showOutliner: true })
    expect(insets.centre).toBe(insets.left + (insets.right - insets.left) / 2)
    expect(insets.centre).not.toBe(WINDOW / 2)
  })

  it('reserves the top row, so pane chrome cannot land under the Toolbar', () => {
    const insets = viewportInsets('build', WINDOW, false)
    expect(insets.top).toBe(GUTTER + 38 + GUTTER)
    expect(insets.top).toBeGreaterThan(6)
  })

  it('describes the free area as a rect for overlay chrome', () => {
    const insets = viewportInsets('compose', WINDOW, true, 873, 240, { composeDock: 'sequence' })
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

  it('sits PiP above the footer pills in Compose', () => {
    const insets = viewportInsets('compose', WINDOW, true, 900, 240, { composeDock: 'sequence' })
    expect(insets.dockBottom).toBe(GUTTER)
    expect(insets.contentBottom).toBe(insets.bottom + FOOTER_ROW_HEIGHT + GUTTER + GUTTER)
    expect(insets.contentBottom).toBeGreaterThan(insets.bottom)
  })

  it('keeps a free canvas in Visualize on a tight window', () => {
    const insets = viewportInsets('visualize', 820, false, 700)
    expect(insets.rightWidth).toBe(0)
    const free = freeAreaRect(insets, 700)
    expect(free.w).toBeGreaterThanOrEqual(200)
    expect(free.h).toBeGreaterThan(0)
  })

  it('shrinks the timeline on a short window so the viewport is not crushed', () => {
    const tall = viewportInsets('compose', WINDOW, true, 900, 240, { composeDock: 'timeline' })
    const short = viewportInsets('compose', WINDOW, true, 360, 240, { composeDock: 'timeline' })
    expect(short.timelineHeight).toBeLessThan(tall.timelineHeight)
    expect(freeAreaRect(short, 360).h).toBeGreaterThan(80)
  })

  it('grows the dock when a taller height is requested', () => {
    const compact = viewportInsets('compose', WINDOW, true, 900, 168, { composeDock: 'timeline' })
    const taller = viewportInsets('compose', WINDOW, true, 900, 320, { composeDock: 'timeline' })
    expect(taller.timelineHeight).toBeGreaterThan(compact.timelineHeight)
    expect(taller.bottom).toBeGreaterThan(compact.bottom)
  })

  it('keeps the toolbar on the right of the free area', () => {
    const insets = viewportInsets('build', WINDOW, false)
    const slot = toolbarSlot(insets, WINDOW)
    expect(slot.right).toBe(GUTTER)
  })

  it('keeps the toolbar on the right edge in Visualize', () => {
    const insets = viewportInsets('visualize', WINDOW, false)
    const slot = toolbarSlot(insets, WINDOW)
    expect(slot.right).toBe(GUTTER)
  })

  it('stops Compose docks before the Director column', () => {
    const insets = viewportInsets('compose', WINDOW, true, 900, 148, { composeDock: 'sequence' })
    const band = chromeBand(insets, WINDOW)
    const dock = directorDockSlot(insets)
    const dockLeft = WINDOW - dock.right - dock.width
    expect(band.left + band.width).toBeLessThanOrEqual(dockLeft - GUTTER)
    expect(band.width).toBeGreaterThan(400)
  })

  it('keeps Compose toolbar and free area left of the Director column', () => {
    const insets = viewportInsets('compose', WINDOW, true, 900, 148, { composeDock: 'sequence' })
    expect(insets.rightWidth).toBe(DIRECTOR_DOCK_WIDTH)
    const tools = toolbarSlot(insets, WINDOW)
    const dock = directorDockSlot(insets)
    const dockLeft = WINDOW - dock.right - dock.width
    expect(WINDOW - tools.right).toBeLessThanOrEqual(dockLeft)
    expect(insets.right).toBeLessThanOrEqual(dockLeft)
  })

  it('Build still floats the composer above the canvas bottom', () => {
    const insets = viewportInsets('build', WINDOW, false)
    expect(insets.dockBottom).toBe(GUTTER + GUTTER)
    expect(insets.contentBottom).toBe(insets.dockBottom + DIRECTOR_COMPOSER_HEIGHT + GUTTER)
  })
})
