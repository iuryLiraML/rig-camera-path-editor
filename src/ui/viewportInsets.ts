import { useEffect, useState } from 'react'
import {
  useEditorStore,
  type ComposeDock,
  type WorkspaceMode,
} from '../state/useEditorStore'

/**
 * Single source of truth for the free area of the viewport — the region not
 * covered by the floating chrome for the current workspace job.
 */

/** gutter used between every docked panel and the window edges */
export const GUTTER = 12

/** height of the floating footer row of pills (look, shading, views, layout) */
export const FOOTER_ROW_HEIGHT = 32
/**
 * Half-size of the drei `GizmoViewport` (scale 22). `GizmoHelper` margin is
 * the widget *centre*, not its corner — park it above the footer row, not on it.
 */
export const AXIS_GIZMO_RADIUS = 40
/** @deprecated Director is a full-height rail; kept for older inset math. */
export const DIRECTOR_COMPOSER_HEIGHT = 100
/** floating Director column on the right of the free area */
export const DIRECTOR_DOCK_WIDTH = 360
/** height of the top row (Toolbar / ModeSwitcher / ProjectChip), both at top-3 */
export const TOP_ROW_HEIGHT = 38

export const LEFT_PANEL_MAX = 280
export const LEFT_PANEL_MIN = 196
export const RIGHT_PANEL_MAX = 360
export const RIGHT_PANEL_MIN = 220
export const TIMELINE_HEIGHT_DEFAULT = 312
/** user-drag cap; chromeSizes still shrinks further to keep MIN_FREE_HEIGHT */
export const TIMELINE_HEIGHT_MAX = 480
export const TIMELINE_MIN = 108
export const SEQUENCE_HEIGHT = 148
/** Review bar in Visualize — shots / cameras / depth / export */
export const VISUALIZE_DOCK_HEIGHT = 148
/** Persistent Add-an-Object tray in Build */
export const ADD_DRAWER_HEIGHT = 280
export const MIN_FREE_WIDTH = 260
export const MIN_FREE_HEIGHT = 140

/**
 * Tools hug the right edge of the free area and size to their contents.
 * A fixed 300px slot plus overflow-x-auto painted a Windows scrollbar under
 * the toolbar.
 */
export function toolbarSlot(insets: ViewportInsets, windowWidth: number): { right: number } {
  return { right: Math.max(GUTTER, windowWidth - insets.right) }
}

/**
 * Axis gizmo sits on `contentBottom` (above the Compose footer, or the
 * window gutter in Build). Look-through / help chips no longer take a band
 * under it — those live on the footer or to the right of the widget.
 */
export function bottomLeftStack(insets: ViewportInsets) {
  const gizmoBottom = insets.contentBottom
  return {
    gizmoMargin: [insets.left + AXIS_GIZMO_RADIUS, gizmoBottom + AXIS_GIZMO_RADIUS] as [
      number,
      number,
    ],
  }
}

/**
 * CSS `right` for the Director column. Always hugs the window edge. Every
 * workspace reserves `rightWidth` so the toolbar and docks sit to its left
 * instead of painting on top of the chat.
 */
export function directorDockSlot(insets: ViewportInsets): { right: number; width: number } {
  const width =
    insets.rightWidth > 0
      ? insets.rightWidth
      : Math.min(DIRECTOR_DOCK_WIDTH, Math.max(0, insets.right - insets.left))
  return { right: GUTTER, width }
}

/**
 * Horizontal band for Compose docks (footer, sequence, timeline) so they stop
 * at the Director column instead of running underneath it.
 */
export function chromeBand(
  insets: ViewportInsets,
  windowWidth: number,
): { left: number; width: number } {
  const dock = directorDockSlot(insets)
  const dockLeft = windowWidth - dock.right - dock.width
  const right = Math.min(insets.right, dockLeft - GUTTER)
  return { left: insets.left, width: Math.max(0, right - insets.left) }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Keep the camera PiP inside the free viewport. Saved `pipRect` values (and the
 * store default `right: 16`) otherwise land under the Director rail or on the
 * timeline after a project hydrate.
 */
export function clampPipRect(
  r: { right: number; bottom: number; fraction: number },
  insets: ViewportInsets,
  vw: number,
  vh: number,
) {
  const w = r.fraction * vw
  const h = r.fraction * vh
  const dock = directorDockSlot(insets)
  const minRight = dock.right + dock.width + GUTTER
  const maxRight = Math.max(minRight, vw - insets.left - w)
  const maxBottom = Math.max(insets.contentBottom, vh - GUTTER - h)
  return {
    ...r,
    right: clamp(r.right, minRight, maxRight),
    bottom: clamp(r.bottom, insets.contentBottom, maxBottom),
  }
}

export interface ChromeSizeInput {
  mode: WorkspaceMode
  composeDock: ComposeDock
  showOutliner: boolean
  timelineVisible: boolean
  requestedHeight?: number
}

export function chromeSizes(
  windowWidth: number,
  windowHeight: number,
  input: ChromeSizeInput,
): { leftWidth: number; rightWidth: number; timelineHeight: number } {
  const requestedHeight = input.requestedHeight ?? TIMELINE_HEIGHT_DEFAULT
  let leftWidth = 0
  let rightWidth = 0
  let timelineHeight = 0

  switch (input.mode) {
    case 'build':
      leftWidth = input.showOutliner ? LEFT_PANEL_MAX : 0
      rightWidth = DIRECTOR_DOCK_WIDTH
      break
    case 'compose':
      leftWidth = input.showOutliner ? LEFT_PANEL_MAX : 0
      rightWidth = DIRECTOR_DOCK_WIDTH
      if (input.timelineVisible) {
        timelineHeight = clamp(requestedHeight, TIMELINE_MIN, TIMELINE_HEIGHT_MAX)
      }
      break
    case 'visualize':
      rightWidth = DIRECTOR_DOCK_WIDTH
      break
    default: {
      const _never: never = input.mode
      return _never
    }
  }

  const sideGutters = GUTTER * 4
  const widthBudget = Math.max(0, windowWidth - sideGutters)
  if (widthBudget - (leftWidth + rightWidth) < MIN_FREE_WIDTH) {
    const panelBudget = Math.max(0, widthBudget - MIN_FREE_WIDTH)
    if (leftWidth > 0 && rightWidth === 0) {
      leftWidth = Math.round(clamp(leftWidth, 0, Math.max(LEFT_PANEL_MIN, panelBudget)))
      if (leftWidth + 0 > widthBudget) leftWidth = Math.max(0, widthBudget)
    } else if (rightWidth > 0 && leftWidth === 0) {
      rightWidth = Math.round(clamp(rightWidth, RIGHT_PANEL_MIN, Math.max(RIGHT_PANEL_MIN, panelBudget)))
      if (rightWidth > widthBudget) rightWidth = Math.max(0, widthBudget)
    } else if (leftWidth > 0 && rightWidth > 0) {
      const scale = panelBudget / (leftWidth + rightWidth)
      leftWidth = Math.round(clamp(leftWidth * scale, LEFT_PANEL_MIN, LEFT_PANEL_MAX))
      rightWidth = Math.round(clamp(rightWidth * scale, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX))
    }
  }

  if (timelineHeight > 0) {
    const verticalChrome = GUTTER + TOP_ROW_HEIGHT + GUTTER + GUTTER + timelineHeight + GUTTER
    const freeH = windowHeight - verticalChrome
    if (freeH < MIN_FREE_HEIGHT) {
      timelineHeight = Math.max(
        TIMELINE_MIN,
        timelineHeight - (MIN_FREE_HEIGHT - freeH),
      )
    }
  }

  return { leftWidth, rightWidth, timelineHeight }
}

export interface ViewportInsets {
  /** first free x, i.e. right edge of the left panel + gutter */
  left: number
  /**
   * First free y from the top, i.e. below the Toolbar / ModeSwitcher row. The
   * split's per-pane controls used to sit at the pane's true corner, which put
   * them under the Toolbar (z-20 over the area layer's z-10) — the close button
   * was measurably unclickable, leaving no way back to a single pane.
   */
  top: number
  /** free width is measured to this x, i.e. left edge of the right panel - gutter */
  right: number
  /** distance from the window bottom to the top of the timeline / sequence dock */
  bottom: number
  /** centre of the free area (footer alignment) */
  centre: number
  /**
   * First free y from the bottom for floating content that must clear the
   * timeline dock and the footer pill row (Compose). Build / Visualize only
   * need to clear the window gutter — Director is a reserved right rail.
   */
  contentBottom: number
  /**
   * Distance from the window bottom to the Director column. The rail is
   * full-height in every workspace (`GUTTER` top and bottom).
   */
  dockBottom: number
  leftWidth: number
  rightWidth: number
  timelineHeight: number
}

export function viewportInsets(
  mode: WorkspaceMode,
  windowWidth: number,
  timelineVisible: boolean,
  windowHeight = 900,
  requestedHeight = TIMELINE_HEIGHT_DEFAULT,
  extras: { composeDock?: ComposeDock; showOutliner?: boolean } = {},
): ViewportInsets {
  const { leftWidth, rightWidth, timelineHeight } = chromeSizes(windowWidth, windowHeight, {
    mode,
    composeDock: extras.composeDock ?? 'timeline',
    showOutliner: extras.showOutliner ?? false,
    timelineVisible,
    requestedHeight,
  })
  const left = leftWidth > 0 ? GUTTER + leftWidth + GUTTER : GUTTER
  const right = windowWidth - (rightWidth > 0 ? GUTTER + rightWidth + GUTTER : GUTTER)
  const visualizeDock = mode === 'visualize' ? VISUALIZE_DOCK_HEIGHT : 0
  const bottom =
    timelineVisible && timelineHeight > 0
      ? GUTTER + timelineHeight + GUTTER
      : visualizeDock > 0
        ? GUTTER + visualizeDock + GUTTER
        : GUTTER
  const footerBand = mode === 'compose' && timelineVisible ? FOOTER_ROW_HEIGHT + GUTTER : 0
  const addDrawerBand = mode === 'build' ? ADD_DRAWER_HEIGHT + GUTTER : 0
  const composeDocked = mode === 'compose' && timelineVisible
  const dockBottom = GUTTER
  const contentBottom = composeDocked
    ? bottom + footerBand + GUTTER
    : bottom + addDrawerBand + GUTTER
  return {
    left,
    top: GUTTER + TOP_ROW_HEIGHT + GUTTER,
    right,
    bottom,
    centre: left + (right - left) / 2,
    dockBottom,
    contentBottom,
    leftWidth,
    rightWidth,
    timelineHeight,
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
    window.visualViewport?.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
    }
  }, [])
  return size
}

/** Reactive variant: re-derives when play mode or the job chrome changes. */
export function useViewportInsets(windowWidth?: number, windowHeight?: number): ViewportInsets {
  const playMode = useEditorStore((s) => s.playMode)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const composeDock = useEditorStore((s) => s.composeDock)
  const showOutliner = useEditorStore((s) => s.showOutliner)
  const timelineHeight = useEditorStore((s) => s.timelineHeight)
  const win = useWindowSize()
  const timelineVisible = !playMode && workspaceMode === 'compose'
  return viewportInsets(
    workspaceMode,
    windowWidth ?? win.w,
    timelineVisible,
    windowHeight ?? win.h,
    timelineHeight,
    { composeDock, showOutliner },
  )
}
