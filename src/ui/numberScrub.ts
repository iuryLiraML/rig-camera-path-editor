/** Click-without-move still focuses the field (D18). */
export const NUMBER_SCRUB_THRESHOLD_PX = 4
/** 8 px of vertical travel = one step at 1× (D20). */
export const NUMBER_SCRUB_PX_PER_STEP = 8

/** Shift wins over Alt so a fine nudge cannot jump 10× by accident. */
export function numberScrubScale(shift: boolean, alt: boolean): number {
  if (shift) return 0.1
  if (alt) return 10
  return 1
}

/**
 * Screen Y grows downward; drag up increases the value (DCC convention).
 * Discrete steps from the pointer-down origin, so the value does not drift.
 */
export function numberScrubValue(
  startValue: number,
  dyFromStart: number,
  step: number,
  scale: number,
): number {
  const steps = Math.round(-dyFromStart / NUMBER_SCRUB_PX_PER_STEP)
  const unit = step * scale
  const next = startValue + steps * unit
  return roundTo(next, decimalsFor(unit))
}

function decimalsFor(unit: number): number {
  if (!Number.isFinite(unit) || unit === 0) return 3
  const abs = Math.abs(unit)
  if (abs >= 1) return 0
  const text = abs.toString()
  const dot = text.indexOf('.')
  if (dot === -1) return 0
  return Math.min(6, text.length - dot - 1)
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
