import { useEffect, useState } from 'react'
import { useEditorStore } from '../state/useEditorStore'
import { TIMELINE_HEIGHT } from './Timeline'

/**
 * Single source of truth for the free area of the viewport — the region not
 * covered by the docked panels.
 *
 * Every floating control used to hard-code its own pixel offsets (left-[244px],
 * right-[252px], right-[332px], pipRect.right: 264…). Those guesses disagreed
 * with each other and with the right panel, which changes width with its tab:
 * the timeline ended up 80 px short of the panel in the Design tab, sat flush
 * against the left panel with no gutter, and the footer centred on the window
 * instead of on the free area, so it overhung the timeline.
 */

/** gutter used between every docked panel and the window edges */
export const GUTTER = 12

/** height of the floating footer row of pills (view modes, views, projection, split) */
const FOOTER_ROW_HEIGHT = 32
/** height of the top row (Toolbar / ViewSwitcher), both at top-3 */
const TOP_ROW_HEIGHT = 38
/** LeftPanel: w-[232px] at left-3 */
const LEFT_PANEL_WIDTH = 232
/** RightPanel: w-60 (design) / w-80 (assistant), both at right-3 */
const RIGHT_PANEL_WIDTH = { design: 240, assistant: 320 } as const

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
}

export function viewportInsets(
  panelTab: 'design' | 'assistant',
  windowWidth: number,
  timelineVisible: boolean,
): ViewportInsets {
  const left = GUTTER + LEFT_PANEL_WIDTH + GUTTER
  const right = windowWidth - (GUTTER + RIGHT_PANEL_WIDTH[panelTab] + GUTTER)
  const bottom = timelineVisible ? GUTTER + TIMELINE_HEIGHT + GUTTER : GUTTER
  return {
    left,
    top: GUTTER + TOP_ROW_HEIGHT + GUTTER,
    right,
    bottom,
    centre: left + (right - left) / 2,
    contentBottom: bottom + GUTTER + FOOTER_ROW_HEIGHT + GUTTER,
  }
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
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/** Reactive variant: re-derives when the right panel's tab changes. */
export function useViewportInsets(windowWidth = window.innerWidth): ViewportInsets {
  const panelTab = useEditorStore((s) => s.panelTab)
  const playMode = useEditorStore((s) => s.playMode)
  return viewportInsets(panelTab, windowWidth, !playMode)
}
