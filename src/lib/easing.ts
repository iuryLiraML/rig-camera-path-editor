/**
 * Animation curves, in the vocabulary professional motion designers already
 * use: Robert Penner's families, expressed as the cubic-bezier approximations
 * that After Effects, Premiere, Figma and CSS all share.
 *
 * A curve runs from (0,0) to (1,1) — x is time, y is progress — so the two
 * control points are all that vary. Families in order of how hard they hit:
 * Sine < Quad < Cubic < Quart < Quint < Expo, plus Circ (arc-like) and Back
 * (overshoots past the target and comes back).
 *
 * For camera work the practice is: `Out` for arrivals (deceleration, the move
 * settles), `In-Out` for A-to-B moves (the slow in / slow out principle), `In`
 * rarely on its own. Bezier values from the standard Penner approximations.
 */

export type EaseKind =
  | 'linear'
  | 'sineIn' | 'sineOut' | 'sineInOut'
  | 'quadIn' | 'quadOut' | 'quadInOut'
  | 'cubicIn' | 'cubicOut' | 'cubicInOut'
  | 'quartIn' | 'quartOut' | 'quartInOut'
  | 'quintIn' | 'quintOut' | 'quintInOut'
  | 'expoIn' | 'expoOut' | 'expoInOut'
  | 'circIn' | 'circOut' | 'circInOut'
  | 'backIn' | 'backOut' | 'backInOut'

export type EaseGroup = 'Common' | 'Ease In' | 'Ease Out' | 'Ease In-Out'

export interface EaseDef {
  kind: EaseKind
  /** the professional name, so it maps onto what people know from AE */
  label: string
  group: EaseGroup
  /** [x1, y1, x2, y2] */
  bezier: [number, number, number, number]
  hint: string
}

/** the shortlist worth reaching for on a camera move */
const COMMON: EaseDef[] = [
  { kind: 'linear', label: 'Linear', group: 'Common', bezier: [0, 0, 1, 1], hint: 'Constant speed — mechanical, technical moves' },
  { kind: 'sineInOut', label: 'Smooth · Sine In-Out', group: 'Common', bezier: [0.445, 0.05, 0.55, 0.95], hint: 'Barely noticeable ease on both ends' },
  { kind: 'cubicOut', label: 'Ease Out · Cubic', group: 'Common', bezier: [0.215, 0.61, 0.355, 1], hint: 'Natural arrival — decelerates into place' },
  { kind: 'cubicIn', label: 'Ease In · Cubic', group: 'Common', bezier: [0.55, 0.055, 0.675, 0.19], hint: 'Soft departure — accelerates away' },
  { kind: 'quartInOut', label: 'Slow In-Out · Quart', group: 'Common', bezier: [0.77, 0, 0.175, 1], hint: 'A-to-B with weight — the workhorse' },
  { kind: 'expoInOut', label: 'Dramatic · Expo In-Out', group: 'Common', bezier: [1, 0, 0, 1], hint: 'Holds, snaps across, holds — reveals' },
  { kind: 'expoOut', label: 'Settle · Expo Out', group: 'Common', bezier: [0.19, 1, 0.22, 1], hint: 'Fast off the mark, locks onto the target' },
  { kind: 'backOut', label: 'Overshoot · Back Out', group: 'Common', bezier: [0.175, 0.885, 0.32, 1.275], hint: 'Passes the target and comes back' },
]

const FAMILIES: { name: string; in: [number, number, number, number]; out: [number, number, number, number]; inOut: [number, number, number, number] }[] = [
  { name: 'Sine', in: [0.47, 0, 0.745, 0.715], out: [0.39, 0.575, 0.565, 1], inOut: [0.445, 0.05, 0.55, 0.95] },
  { name: 'Quad', in: [0.55, 0.085, 0.68, 0.53], out: [0.25, 0.46, 0.45, 0.94], inOut: [0.455, 0.03, 0.515, 0.955] },
  { name: 'Cubic', in: [0.55, 0.055, 0.675, 0.19], out: [0.215, 0.61, 0.355, 1], inOut: [0.645, 0.045, 0.355, 1] },
  { name: 'Quart', in: [0.895, 0.03, 0.685, 0.22], out: [0.165, 0.84, 0.44, 1], inOut: [0.77, 0, 0.175, 1] },
  { name: 'Quint', in: [0.755, 0.05, 0.855, 0.06], out: [0.23, 1, 0.32, 1], inOut: [0.86, 0, 0.07, 1] },
  { name: 'Expo', in: [0.95, 0.05, 0.795, 0.035], out: [0.19, 1, 0.22, 1], inOut: [1, 0, 0, 1] },
  { name: 'Circ', in: [0.6, 0.04, 0.98, 0.335], out: [0.075, 0.82, 0.165, 1], inOut: [0.785, 0.135, 0.15, 0.86] },
  { name: 'Back', in: [0.6, -0.28, 0.735, 0.045], out: [0.175, 0.885, 0.32, 1.275], inOut: [0.68, -0.55, 0.265, 1.55] },
]

function fullList(): EaseDef[] {
  const out: EaseDef[] = [...COMMON]
  const seen = new Set(out.map((e) => e.kind))
  for (const dir of ['In', 'Out', 'InOut'] as const) {
    for (const family of FAMILIES) {
      const kind = `${family.name.toLowerCase()}${dir}` as EaseKind
      if (seen.has(kind)) continue
      out.push({
        kind,
        label: `${family.name} ${dir === 'InOut' ? 'In-Out' : dir}`,
        group: dir === 'In' ? 'Ease In' : dir === 'Out' ? 'Ease Out' : 'Ease In-Out',
        bezier: dir === 'In' ? family.in : dir === 'Out' ? family.out : family.inOut,
        hint: '',
      })
    }
  }
  return out
}

export const EASES: EaseDef[] = fullList()

const BY_KIND = new Map(EASES.map((e) => [e.kind, e]))

export const DEFAULT_EASE: EaseKind = 'quartInOut'

export function easeDef(kind: EaseKind): EaseDef {
  return BY_KIND.get(kind) ?? BY_KIND.get(DEFAULT_EASE)!
}

/** presets grouped for a <select> with <optgroup>s, in a sensible reading order */
export function easeGroups(): { group: EaseGroup; items: EaseDef[] }[] {
  const order: EaseGroup[] = ['Common', 'Ease In-Out', 'Ease Out', 'Ease In']
  return order.map((group) => ({ group, items: EASES.filter((e) => e.group === group) }))
}

// ---------------------------------------------------------------------------
// Cubic-bezier evaluation: solve x(u) = t for u, then return y(u).
// ---------------------------------------------------------------------------

const A = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1
const B = (a1: number, a2: number) => 3 * a2 - 6 * a1
const C = (a1: number) => 3 * a1

const calc = (u: number, a1: number, a2: number) => ((A(a1, a2) * u + B(a1, a2)) * u + C(a1)) * u
const slope = (u: number, a1: number, a2: number) =>
  3 * A(a1, a2) * u * u + 2 * B(a1, a2) * u + C(a1)

/** u such that x(u) ≈ t — Newton-Raphson, bisection when the slope is flat */
function solveU(t: number, x1: number, x2: number) {
  let u = t
  for (let i = 0; i < 8; i++) {
    const s = slope(u, x1, x2)
    if (Math.abs(s) < 1e-6) break
    const x = calc(u, x1, x2) - t
    if (Math.abs(x) < 1e-7) return u
    u -= x / s
  }
  let lo = 0
  let hi = 1
  u = t
  for (let i = 0; i < 24; i++) {
    const x = calc(u, x1, x2)
    if (Math.abs(x - t) < 1e-7) return u
    if (x > t) hi = u
    else lo = u
    u = (lo + hi) / 2
  }
  return u
}

/** Progress 0..1 at normalized time 0..1 through the given curve. */
export function applyEase(kind: EaseKind, t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const [x1, y1, x2, y2] = easeDef(kind).bezier
  if (x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1) return t
  return calc(solveU(t, x1, x2), y1, y2)
}

/** css value, for showing the curve the way the rest of the industry writes it */
export function easeCss(kind: EaseKind) {
  const [x1, y1, x2, y2] = easeDef(kind).bezier
  return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`
}

/**
 * The rig used a single 0..1 "smoothness" slider — a lerp between linear and a
 * quintic smootherstep. Keeping both languages would mean two ways to say the
 * same thing, so the slider is gone from the UI and every remaining producer of
 * a smoothness number (the agent tool, the drone-camera generator, saved
 * projects and shots) maps through here onto the nearest curve.
 */
export function easeForSmoothness(smoothness: number): EaseKind {
  const s = Math.min(1, Math.max(0, smoothness))
  if (s < 0.1) return 'linear'
  if (s < 0.35) return 'sineInOut'
  if (s < 0.6) return 'cubicInOut'
  if (s < 0.85) return 'quartInOut'
  return 'quintInOut'
}
