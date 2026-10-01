import type { CoachmarkPlacement } from './anchors'

/**
 * Pure geometry for the tutorial coachmark (issue #78) — kept out of the React
 * component so it is unit-testable without a DOM. Coordinates are viewport
 * relative (the overlay is position:fixed), so target rects come straight from
 * getBoundingClientRect with no scroll offset.
 */

/** Gap between the highlighted control and the popover (mirrors the layout GUTTER). */
export const COACHMARK_GAP = 12

export type CoachmarkSide = 'top' | 'bottom' | 'left' | 'right'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface SafeArea {
  top: number
  right: number
  bottom: number
  left: number
}

export interface Placement {
  /** false when no side has room — the caller must render a centered card instead of overlapping the control. */
  fits: boolean
  side: CoachmarkSide
  left: number
  top: number
  arrowLeft: number
  arrowTop: number
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi))

export const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b ||
  (a != null &&
    b != null &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height)

/**
 * Place the popover beside `rect` on the preferred side, else the first side with
 * room, clamped into the viewport and safe area. `fits` is false when NO side has
 * room; the caller then renders a centered card rather than an overlapping one
 * (spec: never overlap the taught control).
 */
export function placePopover(
  rect: Rect,
  pop: { w: number; h: number },
  pref: CoachmarkPlacement,
  safe: SafeArea,
  winW: number,
  winH: number,
): Placement {
  const GAP = COACHMARK_GAP
  const fits: Record<CoachmarkSide, boolean> = {
    top: rect.top - safe.top - GAP >= pop.h,
    bottom: winH - (rect.top + rect.height) - safe.bottom - GAP >= pop.h,
    left: rect.left - safe.left - GAP >= pop.w,
    right: winW - (rect.left + rect.width) - safe.right - GAP >= pop.w,
  }
  const order = ([pref, 'bottom', 'top', 'right', 'left'] as CoachmarkPlacement[]).filter(
    (s, i, a) => s !== 'center' && a.indexOf(s) === i,
  ) as CoachmarkSide[]
  const found = order.find((s) => fits[s])
  const side: CoachmarkSide = found ?? 'bottom'
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  let left: number
  let top: number
  if (side === 'bottom') {
    left = cx - pop.w / 2
    top = rect.top + rect.height + GAP
  } else if (side === 'top') {
    left = cx - pop.w / 2
    top = rect.top - pop.h - GAP
  } else if (side === 'right') {
    left = rect.left + rect.width + GAP
    top = cy - pop.h / 2
  } else {
    left = rect.left - pop.w - GAP
    top = cy - pop.h / 2
  }
  left = clamp(left, GAP + safe.left, winW - GAP - safe.right - pop.w)
  top = clamp(top, GAP + safe.top, winH - GAP - safe.bottom - pop.h)
  const arrowLeft = clamp(cx - left, 16, pop.w - 16)
  const arrowTop = clamp(cy - top, 16, pop.h - 16)
  return { fits: Boolean(found), side, left, top, arrowLeft, arrowTop }
}
