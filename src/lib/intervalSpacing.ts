/**
 * Cascadeur-style interval spacing: redistributes time between two keys
 * without changing the values (so the trajectory shape stays put).
 *
 * Weights are 0..1, default 0.5 = identity.
 *   outW < 0.5  linger at the outgoing key (slow start)
 *   outW > 0.5  rush away from it
 *   inW  < 0.5  linger at the incoming key (slow end)
 *   inW  > 0.5  rush into it
 */

export const DEFAULT_SPACING = 0.5

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** Map a 0.5-centered weight to a power: 0.5 → 1, 0 → 3, 1 → 1/3. */
function expFrom(w: number): number {
  const t = (clamp01(w) - 0.5) * 2
  if (t <= 0) return 1 - t * 2
  return 1 / (1 + t * 2)
}

/**
 * Remap normalized time `u` inside an interval. Identity when both weights
 * are 0.5, so existing shots keep their timing until a handle is dragged.
 */
export function applySpacing(
  u: number,
  outW: number = DEFAULT_SPACING,
  inW: number = DEFAULT_SPACING,
): number {
  if (u <= 0) return 0
  if (u >= 1) return 1
  if (Math.abs(outW - DEFAULT_SPACING) < 1e-9 && Math.abs(inW - DEFAULT_SPACING) < 1e-9) {
    return u
  }
  const start = u ** expFrom(outW)
  const end = 1 - (1 - u) ** expFrom(inW)
  return start * (1 - u) + end * u
}

// Handle sits in its half of the interval. Default weights land at 25% / 75%.
const OUT_MIN = 0.08
const OUT_SPAN = 0.34
const IN_MIN = 0.58
const IN_SPAN = 0.34

/** Interval-local position (0..1) of the outgoing handle. */
export function outHandleU(w: number): number {
  return OUT_MIN + clamp01(w) * OUT_SPAN
}

/** Interval-local position (0..1) of the incoming handle. */
export function inHandleU(w: number): number {
  return IN_MIN + (1 - clamp01(w)) * IN_SPAN
}

export function uToOutW(u: number): number {
  return clamp01((u - OUT_MIN) / OUT_SPAN)
}

export function uToInW(u: number): number {
  return clamp01(1 - (u - IN_MIN) / IN_SPAN)
}

export function hasCustomSpacing(key: { easeIn?: number; easeOut?: number }): boolean {
  return (
    (key.easeIn !== undefined && Math.abs(key.easeIn - DEFAULT_SPACING) > 1e-6) ||
    (key.easeOut !== undefined && Math.abs(key.easeOut - DEFAULT_SPACING) > 1e-6)
  )
}
