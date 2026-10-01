import { describe, expect, it } from 'vitest'
import { directorIsCompact, layoutTier } from '../lib/chromeLayout'
import {
  chromeBand,
  chromeSizes,
  clampPipRect,
  COMPACT_DIRECTOR_DOCK_WIDTH,
  DIRECTOR_DOCK_WIDTH,
  directorDockSlot,
  FOOTER_ROW_HEIGHT,
  freeAreaRect,
  GUTTER,
  LEFT_PANEL_MAX,
  MIN_FREE_HEIGHT,
  MIN_FREE_WIDTH,
  PHONE_TASK_BAR_HEIGHT,
  PHONE_TOP_BAR_HEIGHT,
  toolbarSlot,
  viewportInsets,
  VISUALIZE_DOCK_HEIGHT,
  ADD_DRAWER_HEIGHT,
  AXIS_GIZMO_RADIUS,
  bottomLeftStack,
} from './viewportInsets'
import { TIMELINE_HEIGHT } from './Timeline'

const WINDOW = 1202

/** The named viewport matrix from specs/005-responsive-touch/spec.md. */
const NAMED_MATRIX = [
  [360, 800],
  [390, 844],
  [844, 390],
  [768, 1024],
  [1024, 768],
  [1024, 600],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
] as const

describe('viewportInsets', () => {
  it('Build reserves the Director rail when the outliner is closed', () => {
    const insets = viewportInsets('build', WINDOW, false)
    expect(insets.leftWidth).toBe(0)
    expect(insets.rightWidth).toBe(DIRECTOR_DOCK_WIDTH)
    expect(insets.left).toBe(GUTTER)
    expect(insets.right).toBe(WINDOW - GUTTER - DIRECTOR_DOCK_WIDTH - GUTTER)
    expect(insets.bottom).toBe(GUTTER)
  })

  it('budgets the lesson card against only the panels currently shown', () => {
    const focused = viewportInsets('build', WINDOW, false, 900, 240, {
      directorVisible: false,
      addDrawerVisible: false,
    })
    expect(focused.rightWidth).toBe(0)
    expect(focused.right).toBe(WINDOW - GUTTER)
    expect(focused.contentBottom).toBe(GUTTER * 2)

    const figureStep = viewportInsets('build', WINDOW, false, 900, 240, {
      directorVisible: false,
      addDrawerVisible: true,
    })
    expect(figureStep.rightWidth).toBe(0)
    expect(figureStep.contentBottom).toBe(GUTTER * 2 + ADD_DRAWER_HEIGHT + GUTTER)
  })

  it('Build reserves the outliner when it is open', () => {
    const insets = viewportInsets('build', WINDOW, false, 900, 240, { showOutliner: true })
    expect(insets.leftWidth).toBe(LEFT_PANEL_MAX)
    expect(insets.left).toBe(GUTTER + LEFT_PANEL_MAX + GUTTER)
  })

  it('Compose always reserves the requested dock height, even with leftover Sequence state', () => {
    const insets = viewportInsets('compose', WINDOW, true, 900, 240, { composeDock: 'sequence' })
    expect(insets.timelineHeight).toBe(240)
    expect(insets.bottom).toBe(GUTTER + 240 + GUTTER)
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

  it('Visualize reserves the same Director rail as Compose', () => {
    const insets = viewportInsets('visualize', WINDOW, false)
    expect(insets.rightWidth).toBe(DIRECTOR_DOCK_WIDTH)
    expect(insets.right).toBe(WINDOW - GUTTER - DIRECTOR_DOCK_WIDTH - GUTTER)
    expect(insets.leftWidth).toBe(0)
    expect(insets.dockBottom).toBe(GUTTER)
    expect(insets.bottom).toBe(GUTTER + VISUALIZE_DOCK_HEIGHT + GUTTER)
  })

  it('centres on the free area, not on the window, when the outliner is open', () => {
    const insets = viewportInsets('build', WINDOW, false, 900, 240, { showOutliner: true })
    expect(insets.centre).toBe(insets.left + (insets.right - insets.left) / 2)
    expect(insets.centre).not.toBe(WINDOW / 2)
  })

  it('keeps the top row out of every panel, so its controls stay reachable', () => {
    const closed = viewportInsets('build', WINDOW, false, 900, 240, { showOutliner: false })
    const open = viewportInsets('build', WINDOW, false, 900, 240, { showOutliner: true })
    // Panels start at `top`; the row owns the band above it at any panel width.
    expect(open.top).toBe(closed.top)
    expect(toolbarSlot().right).toBe(GUTTER)
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
    expect(insets.rightWidth).toBeGreaterThan(0)
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

  it('runs the toolbar to the window edge, over the band the Director vacated', () => {
    const insets = viewportInsets('build', WINDOW, false)
    const dock = directorDockSlot(insets)
    const dockLeft = WINDOW - dock.right - dock.width
    expect(toolbarSlot().right).toBe(GUTTER)
    // The rail no longer shares the row's band, so overlapping x is fine.
    expect(WINDOW - toolbarSlot().right).toBeGreaterThan(dockLeft)
  })

  it('stops the Visualize review bar before the Director column', () => {
    const insets = viewportInsets('visualize', WINDOW, false)
    const band = chromeBand(insets, WINDOW)
    const dock = directorDockSlot(insets)
    const dockLeft = WINDOW - dock.right - dock.width
    expect(band.left + band.width).toBeLessThanOrEqual(dockLeft - GUTTER)
    expect(insets.contentBottom).toBe(insets.bottom + GUTTER)
  })

  it('anchors the Visualize toolbar to the window edge too', () => {
    expect(toolbarSlot().right).toBe(GUTTER)
  })

  it('stops Compose docks before the Director column', () => {
    const insets = viewportInsets('compose', WINDOW, true, 900, 148, { composeDock: 'sequence' })
    const band = chromeBand(insets, WINDOW)
    const dock = directorDockSlot(insets)
    const dockLeft = WINDOW - dock.right - dock.width
    expect(band.left + band.width).toBeLessThanOrEqual(dockLeft - GUTTER)
    expect(band.width).toBeGreaterThan(400)
  })

  it('keeps the Compose free area left of the Director column', () => {
    const insets = viewportInsets('compose', WINDOW, true, 900, 148, { composeDock: 'sequence' })
    expect(insets.rightWidth).toBe(DIRECTOR_DOCK_WIDTH)
    const dock = directorDockSlot(insets)
    const dockLeft = WINDOW - dock.right - dock.width
    expect(insets.right).toBeLessThanOrEqual(dockLeft)
  })

  it('parks the axis gizmo above the footer row', () => {
    const insets = viewportInsets('compose', WINDOW, true, 900, 240, { composeDock: 'timeline' })
    const stack = bottomLeftStack(insets)
    expect(stack.gizmoMargin[0]).toBe(insets.left + AXIS_GIZMO_RADIUS)
    expect(stack.gizmoMargin[1]).toBe(insets.contentBottom + AXIS_GIZMO_RADIUS)
    expect(insets.contentBottom).toBe(insets.bottom + FOOTER_ROW_HEIGHT + GUTTER + GUTTER)
  })

  it('Build parks floating chrome above the Add-an-Object tray', () => {
    const insets = viewportInsets('build', WINDOW, false)
    expect(insets.dockBottom).toBe(GUTTER)
    expect(insets.contentBottom).toBe(insets.bottom + ADD_DRAWER_HEIGHT + GUTTER + GUTTER)
  })

  it('lifts a hydrated PiP off the Director rail and the Compose timeline', () => {
    const vw = 1440
    const vh = 900
    const insets = viewportInsets('compose', vw, true, vh, 240, {
      composeDock: 'timeline',
      showOutliner: true,
    })
    const clamped = clampPipRect({ right: 16, bottom: 192, fraction: 0.22 }, insets, vw, vh)
    expect(clamped.right).toBeGreaterThanOrEqual(GUTTER + DIRECTOR_DOCK_WIDTH + GUTTER)
    expect(clamped.bottom).toBeGreaterThanOrEqual(insets.contentBottom)
    const again = clampPipRect(clamped, insets, vw, vh)
    expect(again).toEqual(clamped)
  })

  it('uses the compact Director width when the rail is collapsed', () => {
    const sizes = chromeSizes(1280, 800, {
      mode: 'build',
      composeDock: 'timeline',
      showOutliner: false,
      timelineVisible: false,
      directorCompact: true,
    })
    expect(sizes.rightWidth).toBe(COMPACT_DIRECTOR_DOCK_WIDTH)
    const insets = viewportInsets('build', 1280, false, 800, 240, { directorCompact: true })
    expect(insets.rightWidth).toBe(COMPACT_DIRECTOR_DOCK_WIDTH)
    expect(directorDockSlot(insets).width).toBe(COMPACT_DIRECTOR_DOCK_WIDTH)
  })

  it('reserves compact Director width at 1024×600 even if preference is expanded', () => {
    const compact = directorIsCompact(1024, 600, 'expanded')
    const insets = viewportInsets('build', 1024, false, 600, 240, { directorCompact: compact })
    expect(insets.rightWidth).toBe(COMPACT_DIRECTOR_DOCK_WIDTH)
    expect(directorDockSlot(insets).width).toBe(COMPACT_DIRECTOR_DOCK_WIDTH)
  })

  it('keeps expanded Director width at 1024×700 when preference is expanded', () => {
    const compact = directorIsCompact(1024, 700, 'expanded')
    const insets = viewportInsets('build', 1024, false, 700, 240, { directorCompact: compact })
    expect(insets.rightWidth).toBe(DIRECTOR_DOCK_WIDTH)
  })
})

describe('phone shell budget', () => {
  it('reserves no docked rails or dock on phone', () => {
    const sizes = chromeSizes(390, 844, {
      mode: 'compose',
      composeDock: 'timeline',
      showOutliner: true,
      timelineVisible: true,
      directorCompact: true,
      tier: 'phone',
    })
    expect(sizes).toEqual({ leftWidth: 0, rightWidth: 0, timelineHeight: 0 })
  })

  it('spans the free area between the top app bar and the bottom task bar', () => {
    const insets = viewportInsets('build', 390, false, 844, 240, { tier: 'phone' })
    expect(insets.leftWidth).toBe(0)
    expect(insets.rightWidth).toBe(0)
    expect(insets.left).toBe(GUTTER)
    expect(insets.right).toBe(390 - GUTTER)
    expect(insets.top).toBe(PHONE_TOP_BAR_HEIGHT + GUTTER)
    expect(insets.bottom).toBe(PHONE_TASK_BAR_HEIGHT + GUTTER)
    const free = freeAreaRect(insets, 844)
    expect(free.w).toBeGreaterThanOrEqual(MIN_FREE_WIDTH)
    expect(free.h).toBeGreaterThanOrEqual(MIN_FREE_HEIGHT)
  })

  it('insets the phone bars past the device safe area', () => {
    const safeArea = { top: 47, right: 0, bottom: 34, left: 0 }
    const insets = viewportInsets('build', 390, false, 844, 240, { tier: 'phone', safeArea })
    expect(insets.top).toBe(47 + PHONE_TOP_BAR_HEIGHT + GUTTER)
    expect(insets.bottom).toBe(34 + PHONE_TASK_BAR_HEIGHT + GUTTER)
    expect(insets.safeArea).toEqual(safeArea)
  })
})

describe('named viewport matrix', () => {
  it('classifies every named window as a supported tier', () => {
    for (const [w, h] of NAMED_MATRIX) {
      expect(['phone', 'tablet', 'compact', 'full']).toContain(layoutTier(w, h))
    }
  })

  it.each(NAMED_MATRIX)('gives %ix%i a usable, non-overlapping free area', (w, h) => {
    const tier = layoutTier(w, h)
    // Default editor chrome: the outliner is an opt-in overlay, closed at rest.
    const insets = viewportInsets('build', w, false, h, 240, {
      directorCompact: directorIsCompact(w, h, 'auto'),
      tier,
    })
    expect(insets.left).toBeGreaterThanOrEqual(0)
    expect(insets.right).toBeLessThanOrEqual(w)
    expect(insets.right).toBeGreaterThan(insets.left)
    const free = freeAreaRect(insets, h)
    expect(free.w).toBeGreaterThanOrEqual(MIN_FREE_WIDTH)
    expect(free.h).toBeGreaterThanOrEqual(MIN_FREE_HEIGHT)
    if (tier !== 'phone') {
      // On a docked tier the free area never runs under the Director column.
      const dock = directorDockSlot(insets)
      const dockLeft = w - dock.right - dock.width
      expect(insets.right).toBeLessThanOrEqual(dockLeft + 1)
    }
  })

  it.each(NAMED_MATRIX)('gives %ix%i a usable free area in every workspace', (w, h) => {
    const tier = layoutTier(w, h)
    for (const mode of ['build', 'compose', 'visualize'] as const) {
      const timelineVisible = mode === 'compose'
      const insets = viewportInsets(mode, w, timelineVisible, h, 240, {
        directorCompact: directorIsCompact(w, h, 'auto'),
        tier,
      })
      const free = freeAreaRect(insets, h)
      expect(free.w, `${mode} ${w}x${h} width`).toBeGreaterThanOrEqual(MIN_FREE_WIDTH)
      expect(free.h, `${mode} ${w}x${h} height`).toBeGreaterThanOrEqual(MIN_FREE_HEIGHT)
    }
  })

  it('keeps a usable canvas at the narrowest tablet with the default chrome', () => {
    const insets = viewportInsets('build', 600, false, 900, 240, {
      directorCompact: true,
      tier: 'tablet',
    })
    const free = freeAreaRect(insets, 900)
    expect(free.w).toBeGreaterThanOrEqual(MIN_FREE_WIDTH)
    expect(free.h).toBeGreaterThanOrEqual(MIN_FREE_HEIGHT)
  })
})
