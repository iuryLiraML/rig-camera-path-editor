import { keyOutgoingBezier } from './keyframes'
import { plotRange, valueToGraphY, type ValueRange } from './lanePlot'
import type { EaseKind } from './easing'

export type CssBezier = [number, number, number, number]

export type GraphHandle = { t: number; v: number }

/**
 * CSS cubic-bezier control points mapped into shot time / channel value.
 * The geometric cubic through these points *is* the animation curve.
 */
export function cssBezierHandles(
  t0: number,
  t1: number,
  v0: number,
  v1: number,
  bezier: CssBezier,
): [GraphHandle, GraphHandle] {
  const span = t1 - t0
  const vspan = v1 - v0
  const [x1, y1, x2, y2] = bezier
  return [
    { t: t0 + span * x1, v: v0 + vspan * y1 },
    { t: t0 + span * x2, v: v0 + vspan * y2 },
  ]
}

/** Invert a pointer in time/value back to CSS bezier coordinates. */
export function pointerToCssBezier(
  which: 1 | 2,
  time: number,
  value: number,
  t0: number,
  t1: number,
  v0: number,
  v1: number,
  current: CssBezier,
): CssBezier {
  const span = t1 - t0
  const vspan = v1 - v0
  if (span < 1e-9) return current
  const nx = Math.min(1, Math.max(0, (time - t0) / span))
  const ny = Math.abs(vspan) < 1e-9 ? current[which === 1 ? 1 : 3] : (value - v0) / vspan
  const [x1, y1, x2, y2] = current
  return which === 1 ? [nx, ny, x2, y2] : [x1, y1, nx, ny]
}

/** SVG cubic `C` for one segment, in the graph viewBox (time×100, graph Y). */
export function cubicSegmentPath(
  t0: number,
  t1: number,
  v0: number,
  v1: number,
  bezier: CssBezier,
  range: ValueRange,
): string {
  const y = (value: number) => valueToGraphY(value, range)
  const [h1, h2] = cssBezierHandles(t0, t1, v0, v1, bezier)
  return `M ${t0 * 100} ${y(v0)} C ${h1.t * 100} ${y(h1.v)} ${h2.t * 100} ${y(h2.v)} ${t1 * 100} ${y(v1)}`
}

export function handleValues(v0: number, v1: number, bezier: CssBezier): number[] {
  const vspan = v1 - v0
  return [v0 + vspan * bezier[1], v0 + vspan * bezier[3]]
}

/** Widen the plot range so overshoot handles (Back, pulled tangents) stay on-graph. */
export function rangeWithHandles(
  base: ValueRange,
  keys: {
    time: number
    value?: number
    ease?: EaseKind
    easeBezier?: CssBezier
  }[],
  defaultEase: EaseKind,
): ValueRange {
  const sorted = [...keys]
    .filter((key) => key.value !== undefined)
    .sort((a, b) => a.time - b.time)
  const extra: number[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const left = sorted[i]
    const right = sorted[i + 1]
    extra.push(
      ...handleValues(
        left.value as number,
        right.value as number,
        keyOutgoingBezier(left, defaultEase),
      ),
    )
  }
  return plotRange(extra, base)
}
