import { createContext } from 'react'
import { FULL_TIME_VIEW, xToTime, type TimeView } from '../../lib/timeView'
import { TIMELINE_HEIGHT_DEFAULT } from '../viewportInsets'

/** height of the docked timeline, used by other floating UI to move out of the way */
export const TIMELINE_HEIGHT = TIMELINE_HEIGHT_DEFAULT

export const TimeViewCtx = createContext<TimeView>(FULL_TIME_VIEW)

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** seconds → x% and back, shared by ruler/tracks so everything lines up */
export function timeFromEvent(e: { clientX: number }, lane: HTMLElement, view: TimeView) {
  const rect = lane.getBoundingClientRect()
  const x = (e.clientX - rect.left) / Math.max(1e-6, rect.width)
  return xToTime(x, view)
}
