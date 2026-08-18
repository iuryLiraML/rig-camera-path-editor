/**
 * Map a channel value onto a timeline lane the same way TrackCurve draws it.
 * viewBox Y is 0 at the top; a normalized 0 sits near the bottom with padding.
 */
export const LANE_Y0 = 94
export const LANE_YSPAN = 88

export type ValueRange = { lo: number; hi: number }

export const RANGE_PROGRESS: ValueRange = { lo: 0, hi: 1 }
export const RANGE_UNIT: ValueRange = { lo: 0, hi: 1 }
export const RANGE_FOV: ValueRange = { lo: 20, hi: 90 }
export const RANGE_ROLL: ValueRange = { lo: -30, hi: 30 }
export const RANGE_LOOK: ValueRange = { lo: -2, hi: 4 }

/** Expand the default range so every sample and key sits inside it. */
export function plotRange(values: number[], defaults: ValueRange): ValueRange {
  let lo = defaults.lo
  let hi = defaults.hi
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (hi - lo < 1e-6) {
    const pad = Math.max(1e-3, Math.abs(lo) * 0.05 + 0.5)
    return { lo: lo - pad, hi: hi + pad }
  }
  return { lo, hi }
}

export function valueToLaneY(value: number, range: ValueRange): number {
  const span = range.hi - range.lo
  const n = span < 1e-9 ? 0.5 : (value - range.lo) / span
  return LANE_Y0 - Math.min(1, Math.max(0, n)) * LANE_YSPAN
}

/**
 * Same mapping as valueToLaneY, but overshoot is not clipped. Graph handles
 * (Back, pulled tangents) sit outside the keys and must stay on the cubic.
 */
export function valueToGraphY(value: number, range: ValueRange): number {
  const span = range.hi - range.lo
  const n = span < 1e-9 ? 0.5 : (value - range.lo) / span
  return LANE_Y0 - n * LANE_YSPAN
}

/** Invert valueToLaneY. n is unclamped so bezier handles can overshoot. */
export function laneYToValue(yPct: number, range: ValueRange): number {
  const n = (LANE_Y0 - yPct) / LANE_YSPAN
  return range.lo + n * (range.hi - range.lo)
}

export function valueFromLanePointer(
  clientY: number,
  lane: HTMLElement,
  range: ValueRange,
): number {
  const rect = lane.getBoundingClientRect()
  const yPct = ((clientY - rect.top) / Math.max(1e-6, rect.height)) * 100
  return laneYToValue(yPct, range)
}

export function normalizeInRange(values: number[], range: ValueRange): number[] {
  const span = range.hi - range.lo
  if (span < 1e-9) return values.map(() => 0.5)
  return values.map((v) => (v - range.lo) / span)
}

export function clampChannelValue(channel: 'progress' | 'fov' | 'roll' | 'unit', value: number): number {
  switch (channel) {
    case 'progress':
      return Math.min(1, Math.max(0, value))
    case 'fov':
      return Math.min(170, Math.max(5, value))
    case 'roll':
      return Math.min(180, Math.max(-180, value))
    case 'unit':
      return Math.min(1, Math.max(0, value))
    default: {
      const _never: never = channel
      return _never
    }
  }
}

export type GraphValueFormat = 'percent' | 'degrees' | 'unit' | 'look'

/** Evenly spaced ticks for the Graph Editor value axis. */
export function graphValueTicks(range: ValueRange, count = 5): number[] {
  const n = Math.max(2, count)
  return Array.from({ length: n }, (_, i) => range.lo + ((range.hi - range.lo) * i) / (n - 1))
}

export function formatGraphValue(format: GraphValueFormat, value: number): string {
  switch (format) {
    case 'percent':
      return `${Math.round(value * 100)}%`
    case 'degrees':
      return `${Math.round(value)}°`
    case 'look':
    case 'unit':
      return value.toFixed(2)
    default: {
      const _never: never = format
      return _never
    }
  }
}
