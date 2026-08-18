/**
 * Visible window of the timeline, in shot-normalized 0..1 time.
 *
 * The dock used to map every lane as the whole shot. Zooming the ruler is only
 * honest if keys, curves, the playhead and pointer mapping share this window.
 */

export type TimeView = {
  /** left edge of the window, 0..1-span */
  start: number
  /** width of the window, MIN_TIME_SPAN..1 */
  span: number
}

export const FULL_TIME_VIEW: TimeView = { start: 0, span: 1 }

/**
 * Tightest zoom: a couple of frames on a typical shot. Matches the 30 fps
 * MP4 export so the ruler can count frames the way After Effects does.
 */
export const TIMELINE_FPS = 30

/** ~0.8 % of the shot — about 1–2 frames on a 6 s / 30 fps clip */
export const MIN_TIME_SPAN = 0.008

const FRAME_STEPS = [1, 2, 5, 10, 15, 30, 60, 90, 150, 300, 600]

export function clampTimeView(start: number, span: number): TimeView {
  const nextSpan = Math.min(1, Math.max(MIN_TIME_SPAN, span))
  const nextStart = Math.min(1 - nextSpan, Math.max(0, start))
  return { start: nextStart, span: nextSpan }
}

/** Map shot time → x in the lane (0 = left edge, 1 = right). May fall outside 0..1. */
export function timeToX(t: number, view: TimeView): number {
  return (t - view.start) / view.span
}

/** Map lane x (0..1) → shot time, then clamp to the shot. */
export function xToTime(x: number, view: TimeView): number {
  return Math.min(1, Math.max(0, view.start + x * view.span))
}

/**
 * Zoom so `anchor` (usually the cursor's time, else the playhead) stays at the
 * same x. factor < 1 zooms in; factor > 1 zooms out.
 */
export function zoomAround(view: TimeView, anchor: number, factor: number): TimeView {
  const nextSpan = view.span * factor
  const x = timeToX(anchor, view)
  const safeX = Number.isFinite(x) ? x : 0.5
  return clampTimeView(anchor - safeX * nextSpan, nextSpan)
}

export function panTimeView(view: TimeView, delta: number): TimeView {
  return clampTimeView(view.start + delta, view.span)
}

export function timeInView(t: number, view: TimeView, pad = 0): boolean {
  const x = timeToX(t, view)
  return x >= -pad && x <= 1 + pad
}

export function isZoomed(view: TimeView): boolean {
  return view.span < 1 - 1e-6
}

export function shotFrameCount(duration: number, fps = TIMELINE_FPS): number {
  return Math.max(1, Math.round(duration * fps))
}

/** Frame index at normalized time t. t=0 → 0; t=1 → duration×fps (the end). */
export function timeToFrame(t: number, duration: number, fps = TIMELINE_FPS): number {
  const total = duration * fps
  return Math.min(total, Math.max(0, Math.round(t * total)))
}

export function frameToTime(frame: number, duration: number, fps = TIMELINE_FPS): number {
  const total = duration * fps
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, frame / total))
}

/** Snap normalized time onto the 30 fps export grid (After Effects default). */
export function snapToFrame(t: number, duration: number, fps = TIMELINE_FPS): number {
  return frameToTime(timeToFrame(t, duration, fps), duration, fps)
}

/** AE-style seconds:frames for a short shot — `0:12` is 12 frames into second 0. */
export function formatTimecode(t: number, duration: number, fps = TIMELINE_FPS): string {
  const frame = timeToFrame(t, duration, fps)
  const sec = Math.floor(frame / fps)
  const f = Math.round(frame - sec * fps)
  return `${sec}:${String(f).padStart(2, '0')}`
}

function formatRulerLabel(frame: number, fps: number): string {
  const sec = Math.floor(frame / fps)
  const f = Math.round(frame - sec * fps)
  if (f === 0) return `${sec}s`
  return `${sec}:${String(f).padStart(2, '0')}`
}

function stepForVisibleFrames(visibleFrames: number): number {
  for (const step of FRAME_STEPS) {
    if (visibleFrames / step <= 14) return step
  }
  return FRAME_STEPS[FRAME_STEPS.length - 1]
}

/**
 * Tick marks for the visible window. Step is in frames so zooming in reveals
 * 0:15, then every 5 frames, then every frame — the After Effects ruler.
 */
export function rulerMarks(
  duration: number,
  view: TimeView,
  fps = TIMELINE_FPS,
): { t: number; label: string | null; major: boolean }[] {
  if (duration <= 0 || fps <= 0) return []
  const total = duration * fps
  const visibleFrames = view.span * total
  const step = stepForVisibleFrames(visibleFrames)
  const f0 = view.start * total
  const f1 = (view.start + view.span) * total
  const first = Math.ceil((f0 - 1e-6) / step) * step
  const marks: { t: number; label: string | null; major: boolean }[] = []
  for (let frame = first; frame <= f1 + 1e-6; frame += step) {
    const t = Math.min(1, Math.max(0, frame / total))
    const onSecond = Math.abs(frame / fps - Math.round(frame / fps)) < 1e-6
    const pastEnd = t >= 1 - 1e-9 && frame > 0
    const major = onSecond || step <= 2
    let label: string | null = null
    if (!pastEnd) {
      if (step >= fps) {
        if (onSecond) label = `${Math.round(frame / fps)}s`
      } else if (step >= 10) {
        if (onSecond || Math.abs(frame / (2 * step) - Math.round(frame / (2 * step))) < 1e-6) {
          label = formatRulerLabel(Math.round(frame), fps)
        }
      } else {
        label = formatRulerLabel(Math.round(frame), fps)
      }
    }
    marks.push({ t, label, major })
  }
  return marks
}

/** Wheel delta → zoom factor. Scroll down / pinch-out zooms out (see more time). */
export function wheelZoomFactor(deltaY: number): number {
  const clamped = Math.min(160, Math.max(-160, deltaY))
  return Math.min(1.8, Math.max(0.55, Math.pow(1.0024, clamped)))
}
