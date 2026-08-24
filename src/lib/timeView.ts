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
 * Frame rates a shot can use. Animation stays a pure function of t (0..1);
 * fps only maps seconds ↔ frames for the ruler, snap, and MP4 export.
 */
export const SHOT_FPS_OPTIONS = [24, 25, 30, 60] as const
export type ShotFps = (typeof SHOT_FPS_OPTIONS)[number]
export const DEFAULT_SHOT_FPS: ShotFps = 30
/** Default shot / export fps when a file has none. Keep the name — callers pass an override. */
export const TIMELINE_FPS = DEFAULT_SHOT_FPS

export function isShotFps(value: number): value is ShotFps {
  return (SHOT_FPS_OPTIONS as readonly number[]).includes(value)
}

/** Missing or unknown fps → 30 so old JSON does not jump. */
export function normalizeShotFps(value: unknown): ShotFps {
  const n = typeof value === 'number' ? value : Number(value)
  return isShotFps(n) ? n : DEFAULT_SHOT_FPS
}

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

export function shotFrameCount(duration: number, fps: number = DEFAULT_SHOT_FPS): number {
  return Math.max(1, Math.round(duration * normalizeShotFps(fps)))
}

export const MIN_SHOT_DURATION = 1
export const MAX_SHOT_DURATION = 30

export function clampShotDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_SHOT_DURATION
  return Math.min(MAX_SHOT_DURATION, Math.max(MIN_SHOT_DURATION, seconds))
}

export function minShotFrames(fps: number): number {
  return Math.round(normalizeShotFps(fps) * MIN_SHOT_DURATION)
}

export function maxShotFrames(fps: number): number {
  return Math.round(normalizeShotFps(fps) * MAX_SHOT_DURATION)
}

/** Shot length from a frame count at the export fps. Clamped to 1–30 s. */
export function durationFromFrameCount(frames: number, fps: number = DEFAULT_SHOT_FPS): number {
  const n = Math.round(Number(frames))
  const rate = normalizeShotFps(fps)
  if (!Number.isFinite(n) || n < 1) return MIN_SHOT_DURATION
  return clampShotDuration(n / rate)
}

/** Frame index at normalized time t. t=0 → 0; t=1 → duration×fps (the end). */
export function timeToFrame(t: number, duration: number, fps: number = DEFAULT_SHOT_FPS): number {
  const rate = normalizeShotFps(fps)
  const total = duration * rate
  return Math.min(total, Math.max(0, Math.round(t * total)))
}

export function frameToTime(frame: number, duration: number, fps: number = DEFAULT_SHOT_FPS): number {
  const rate = normalizeShotFps(fps)
  const total = duration * rate
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, frame / total))
}

/** Snap normalized time onto the shot fps grid (After Effects composition timebase). */
export function snapToFrame(t: number, duration: number, fps: number = DEFAULT_SHOT_FPS): number {
  return frameToTime(timeToFrame(t, duration, fps), duration, fps)
}

/** AE-style seconds:frames for a short shot — `0:12` is 12 frames into second 0. */
export function formatTimecode(t: number, duration: number, fps: number = DEFAULT_SHOT_FPS): string {
  const rate = normalizeShotFps(fps)
  const frame = timeToFrame(t, duration, rate)
  const sec = Math.floor(frame / rate)
  const f = Math.round(frame - sec * rate)
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
  fps: number = DEFAULT_SHOT_FPS,
): { t: number; label: string | null; major: boolean }[] {
  const rate = normalizeShotFps(fps)
  if (duration <= 0 || rate <= 0) return []
  const total = duration * rate
  const visibleFrames = view.span * total
  const step = stepForVisibleFrames(visibleFrames)
  const f0 = view.start * total
  const f1 = (view.start + view.span) * total
  const first = Math.ceil((f0 - 1e-6) / step) * step
  const marks: { t: number; label: string | null; major: boolean }[] = []
  for (let frame = first; frame <= f1 + 1e-6; frame += step) {
    const t = Math.min(1, Math.max(0, frame / total))
    const onSecond = Math.abs(frame / rate - Math.round(frame / rate)) < 1e-6
    const pastEnd = t >= 1 - 1e-9 && frame > 0
    const major = onSecond || step <= 2
    let label: string | null = null
    if (!pastEnd) {
      if (step >= rate) {
        if (onSecond) label = `${Math.round(frame / rate)}s`
      } else if (step >= 10) {
        if (onSecond || Math.abs(frame / (2 * step) - Math.round(frame / (2 * step))) < 1e-6) {
          label = formatRulerLabel(Math.round(frame), rate)
        }
      } else {
        label = formatRulerLabel(Math.round(frame), rate)
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
