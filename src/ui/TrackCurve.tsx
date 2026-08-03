/**
 * The animation curve of a track, drawn inside its lane.
 *
 * The timeline showed keyframes as diamonds and nothing else, so the curve you
 * picked for a segment — the whole point of choosing Expo Out over Sine In-Out —
 * was invisible: you had to play the shot to find out what it did. This plots
 * the channel's actual value over time, the way a graph editor does, so the
 * shape of the easing is readable at a glance.
 *
 * Read-only on purpose: the curve is edited per keyframe in the right panel.
 * The viewBox is 0..100 in both axes with preserveAspectRatio="none", so the
 * plot stretches to whatever size the lane happens to be.
 */
export function TrackCurve({ samples, color }: { samples: number[]; color: string }) {
  if (samples.length < 2) return null

  // 6% padding top and bottom so a flat 0 or 1 is not drawn on the lane border
  const points = samples
    .map((v, i) => {
      const x = (i / (samples.length - 1)) * 100
      const y = 94 - Math.min(1, Math.max(0, v)) * 88
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeOpacity={0.75}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Normalize a channel's values into 0..1 for plotting. A channel whose value
 * never changes plots down the middle rather than collapsing onto an edge.
 */
export function normalizeSamples(values: number[]): number[] {
  if (values.length === 0) return []
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const span = hi - lo
  if (!Number.isFinite(span) || span < 1e-9) return values.map(() => 0.5)
  return values.map((v) => (v - lo) / span)
}

/** how many points to plot across a lane — smooth enough at any dock width */
export const CURVE_SAMPLES = 96

/** sample a function of normalized time at CURVE_SAMPLES evenly spaced points */
export function sampleOverTime(fn: (t: number) => number): number[] {
  return Array.from({ length: CURVE_SAMPLES }, (_, i) => fn(i / (CURVE_SAMPLES - 1)))
}
