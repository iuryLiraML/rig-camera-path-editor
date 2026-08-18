import { useEffect, useState } from 'react'
import { useEditorStore } from '../state/useEditorStore'

/**
 * Single source of truth for the free area of the viewport — the region not
 * covered by the docked panels.
 *
 * Chrome widths used to be hardcoded (232 / 320 / 168). On a small window or
 * browser zoom those panels ate the canvas. Sizes now scale down so a minimum
 * free area always remains.
 */

/** gutter used between every docked panel and the window edges */
export const GUTTER = 12

/** height of the floating footer row of pills (view modes, views, projection, split) */
const FOOTER_ROW_HEIGHT = 32
/** height of the top row (Toolbar / ViewSwitcher), both at top-3 */
const TOP_ROW_HEIGHT = 38

export const LEFT_PANEL_MAX = 280
export const LEFT_PANEL_MIN = 196
export const RIGHT_PANEL_MAX = 320
export const RIGHT_PANEL_MIN = 220
export const TIMELINE_HEIGHT_DEFAULT = 240
/** user-drag cap; chromeSizes still shrinks further to keep MIN_FREE_HEIGHT */
export const TIMELINE_HEIGHT_MAX = 480
export const TIMELINE_MIN = 108
export const MIN_FREE_WIDTH = 260
export const MIN_FREE_HEIGHT = 140

/**
 * Projects / Editor / Board pill sits at the left of the free area. The tool
 * bar used to centre itself in that same strip; after W/E/R it grew wide enough
 * to paint over "Board". Reserve this many px so the two never share x.
 */
export const VIEW_SWITCHER_RESERVE = 212

export function toolbarSlot(insets: ViewportInsets): { left: number; width: number } {
  const left = insets.left + VIEW_SWITCHER_RESERVE + GUTTER
  return { left, width: Math.max(120, insets.right - left) }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function chromeSizes(
  windowWidth: number,
  windowHeight: number,
  timelineVisible: boolean,
  requestedHeight = TIMELINE_HEIGHT_DEFAULT,
): { leftWidth: number; rightWidth: number; timelineHeight: number } {
  const sideGutters = GUTTER * 4
  const widthBudget = Math.max(0, windowWidth - sideGutters)

  let leftWidth = LEFT_PANEL_MAX
  let rightWidth = RIGHT_PANEL_MAX
  if (widthBudget - (leftWidth + rightWidth) < MIN_FREE_WIDTH) {
    const panelBudget = Math.max(LEFT_PANEL_MIN + RIGHT_PANEL_MIN, widthBudget - MIN_FREE_WIDTH)
    const scale = panelBudget / (LEFT_PANEL_MAX + RIGHT_PANEL_MAX)
    leftWidth = Math.round(clamp(LEFT_PANEL_MAX * scale, LEFT_PANEL_MIN, LEFT_PANEL_MAX))
    rightWidth = Math.round(clamp(RIGHT_PANEL_MAX * scale, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX))
    if (leftWidth + rightWidth > widthBudget) {
      const overflow = leftWidth + rightWidth - widthBudget
      const fromRight = Math.min(overflow, Math.max(0, rightWidth - 196))
      rightWidth -= fromRight
      leftWidth = Math.max(148, leftWidth - (overflow - fromRight))
    }
  }

  let timelineHeight = timelineVisible
    ? clamp(requestedHeight, TIMELINE_MIN, TIMELINE_HEIGHT_MAX)
    : 0
  if (timelineVisible) {
    const verticalChrome = GUTTER + TOP_ROW_HEIGHT + GUTTER + GUTTER + timelineHeight + GUTTER
    const freeH = windowHeight - verticalChrome
    if (freeH < MIN_FREE_HEIGHT) {
      timelineHeight = Math.max(TIMELINE_MIN, timelineHeight - (MIN_FREE_HEIGHT - freeH))
    }
  }

  return { leftWidth, rightWidth, timelineHeight }
}

export interface ViewportInsets {
  /** first free x, i.e. right edge of the left panel + gutter */
  left: number
  /**
   * First free y from the top, i.e. below the Toolbar / ViewSwitcher row. The
   * split's per-pane controls used to sit at the pane's true corner, which put
   * them under the Toolbar (z-20 over the area layer's z-10) — the close button
   * was measurably unclickable, leaving no way back to a single pane.
   */
  top: number
  /** free width is measured to this x, i.e. left edge of the right panel - gutter */
  right: number
  /** distance from the window bottom to the top of the timeline dock */
  bottom: number
  /** centre of the free area (footer alignment) */
  centre: number
  /**
   * First free y from the bottom for floating content that must clear BOTH the
   * timeline dock and the footer pill row — e.g. the camera PiP, which used to
   * be parked on top of the footer.
   */
  contentBottom: number
  leftWidth: number
  rightWidth: number
  timelineHeight: number
}

export function viewportInsets(
  _panelTab: 'design' | 'assistant',
  windowWidth: number,
  timelineVisible: boolean,
  windowHeight = 900,
  requestedHeight = TIMELINE_HEIGHT_DEFAULT,
): ViewportInsets {
  const { leftWidth, rightWidth, timelineHeight } = chromeSizes(
    windowWidth,
    windowHeight,
    timelineVisible,
    requestedHeight,
  )
  const left = GUTTER + leftWidth + GUTTER
  const right = windowWidth - (GUTTER + rightWidth + GUTTER)
  const bottom = timelineVisible ? GUTTER + timelineHeight + GUTTER : GUTTER
  const insets = {
    left,
    top: GUTTER + TOP_ROW_HEIGHT + GUTTER,
    right,
    bottom,
    centre: left + (right - left) / 2,
    contentBottom: bottom + GUTTER + FOOTER_ROW_HEIGHT + GUTTER,
    leftWidth,
    rightWidth,
    timelineHeight,
  }
  return insets
}

/**
 * The free area as a top-left rect, for chrome that must stay clickable — the
 * canvas itself still spans the whole window behind the floating panels.
 */
export function freeAreaRect(insets: ViewportInsets, windowHeight: number) {
  return {
    x: insets.left,
    y: insets.top,
    w: Math.max(0, insets.right - insets.left),
    h: Math.max(0, windowHeight - insets.bottom - insets.top),
  }
}

export interface XYWH {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Overlap of two top-left rects. Panes tile the whole canvas so the render stays
 * full-bleed behind the floating panels, but anything that must be *read* or
 * clicked — pane controls, and the camera pane's export frame — has to be
 * confined to the part that is not behind a panel.
 */
export function intersectRect(a: XYWH, b: XYWH): XYWH {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return {
    x,
    y,
    w: Math.min(a.x + a.w, b.x + b.w) - x,
    h: Math.min(a.y + a.h, b.y + b.h) - y,
  }
}

/** Window size, tracked so overlays re-place themselves on resize. */
export function useWindowSize() {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
    }
  }, [])
  return size
}

/** Reactive variant: re-derives when play mode hides the timeline. */
export function useViewportInsets(windowWidth?: number, windowHeight?: number): ViewportInsets {
  const panelTab = useEditorStore((s) => s.panelTab)
  const playMode = useEditorStore((s) => s.playMode)
  const timelineHeight = useEditorStore((s) => s.timelineHeight)
  const win = useWindowSize()
  return viewportInsets(panelTab, windowWidth ?? win.w, !playMode, windowHeight ?? win.h, timelineHeight)
}
