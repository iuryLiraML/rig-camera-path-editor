import { createContext } from 'react'
import { FULL_TIME_VIEW, xToTime, type TimeView } from '../../lib/timeView'
import { TIMELINE_HEIGHT_DEFAULT } from '../viewportInsets'

/** height of the docked timeline, used by other floating UI to move out of the way */
export const TIMELINE_HEIGHT = TIMELINE_HEIGHT_DEFAULT

/** Left track-label column. Keep class, ruler spacers, and playhead inset in sync. */
export const TRACK_LABEL_CLASS = 'w-52 shrink-0'
/** Right column: Add / Remove keyframe actions (keep ruler + playhead inset in sync). */
export const TRACK_ADD_CLASS = 'w-[4.25rem] shrink-0'
/** w-52 + gap-2 — playhead overlay lines up with the lane, not the label. */
export const TRACK_LANE_LEFT = '13.5rem'
/** gap-2 + w-[4.25rem] */
export const TRACK_LANE_RIGHT = '5.25rem'

export const TimeViewCtx = createContext<TimeView>(FULL_TIME_VIEW)

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** seconds → x% and back, shared by ruler/tracks so everything lines up */
export function timeFromEvent(e: { clientX: number }, lane: HTMLElement, view: TimeView) {
  const rect = lane.getBoundingClientRect()
  const x = (e.clientX - rect.left) / Math.max(1e-6, rect.width)
  return xToTime(x, view)
}
