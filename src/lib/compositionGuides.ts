/** φ − 1 = 1/φ ≈ 0.618. Golden-section lines sit at 1/φ² and 1/φ of each axis. */
export const PHI = (1 + Math.sqrt(5)) / 2
export const GOLDEN_NEAR = 1 / (PHI * PHI)
export const GOLDEN_FAR = 1 / PHI

export type CompositionGuideId = 'thirds' | 'golden' | 'spiral' | 'safe'

export const COMPOSITION_GUIDE_IDS = ['thirds', 'golden', 'spiral', 'safe'] as const

export type CompositionGuides = Record<CompositionGuideId, boolean>

export const DEFAULT_COMPOSITION_GUIDES: CompositionGuides = {
  thirds: true,
  golden: false,
  spiral: false,
  safe: true,
}

export function toggleCompositionGuide(
  current: CompositionGuides,
  id: CompositionGuideId,
): CompositionGuides {
  return { ...current, [id]: !current[id] }
}

/** Vertical / horizontal line positions in 0..1 of the frame. */
export function thirdsLines(): { x: [number, number]; y: [number, number] } {
  return { x: [1 / 3, 2 / 3], y: [1 / 3, 2 / 3] }
}

export function goldenLines(): { x: [number, number]; y: [number, number] } {
  return { x: [GOLDEN_NEAR, GOLDEN_FAR], y: [GOLDEN_NEAR, GOLDEN_FAR] }
}

/** Outer breathing (action) and inner title-safe insets as a fraction of the frame. */
export function safeInsets(): { action: number; title: number } {
  return { action: 0.05, title: 0.1 }
}

export type Rect = { x: number; y: number; w: number; h: number }

/**
 * Largest inner rect of `innerAspect` (width/height) that fits in the outer
 * box — film-gate letterbox / pillarbox for look-through overlays.
 */
export function containRect(outerW: number, outerH: number, innerAspect: number): Rect {
  const w = Math.max(1, outerW)
  const h = Math.max(1, outerH)
  const aspect = Math.max(0.05, innerAspect)
  const pane = w / h
  if (aspect < pane) {
    const gw = h * aspect
    return { x: (w - gw) / 2, y: 0, w: gw, h }
  }
  const gh = w / aspect
  return { x: 0, y: (h - gh) / 2, w, h: gh }
}

/**
 * Largest golden rectangle centered in a pixel frame. The spiral is drawn
 * inside this so 16:9 / 9:16 / 1:1 all get a true φ proportion.
 */
export function goldenRect(width: number, height: number): Rect {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const landscape: Rect =
    w / h >= PHI
      ? { x: (w - h * PHI) / 2, y: 0, w: h * PHI, h }
      : { x: 0, y: (h - w / PHI) / 2, w, h: w / PHI }
  const portrait: Rect =
    h / w >= PHI
      ? { x: 0, y: (h - w * PHI) / 2, w, h: w * PHI }
      : { x: (w - h / PHI) / 2, y: 0, w: h / PHI, h }
  return landscape.w * landscape.h >= portrait.w * portrait.h ? landscape : portrait
}

export type SpiralCut = 'left' | 'top' | 'right' | 'bottom'

export type SpiralArc = {
  start: [number, number]
  end: [number, number]
  radius: number
  square: Rect
  cut: SpiralCut
}

function nextCut(cut: SpiralCut): SpiralCut {
  switch (cut) {
    case 'left':
      return 'top'
    case 'top':
      return 'right'
    case 'right':
      return 'bottom'
    case 'bottom':
      return 'left'
    default: {
      const _never: never = cut
      return _never
    }
  }
}

/**
 * Whirling-square golden spiral on a φ rectangle: each quarter-circle lives
 * in a Fibonacci square and starts where the last one ended. Landscape
 * starts on the left (SW → NE); portrait starts on the top (NW → SE).
 * For a camera overlay on 16:9 / 9:16, scale this onto the frame with
 * `goldenSpiralArcsForFrame` (elliptical arcs that fill the gate).
 */
export function goldenSpiralArcs(rect: Rect): SpiralArc[] {
  const arcs: SpiralArc[] = []
  let x = rect.x
  let y = rect.y
  let w = rect.w
  let h = rect.h
  let cut: SpiralCut = w >= h ? 'left' : 'top'

  for (let i = 0; i < 12; i++) {
    const s = Math.min(w, h)
    if (s < 1.5) break

    let start: [number, number]
    let end: [number, number]
    let square: Rect

    switch (cut) {
      case 'left':
        square = { x, y, w: s, h: s }
        start = [x, y + s]
        end = [x + s, y]
        x += s
        w -= s
        break
      case 'top':
        square = { x, y, w: s, h: s }
        start = [x, y]
        end = [x + s, y + s]
        y += s
        h -= s
        break
      case 'right':
        square = { x: x + w - s, y, w: s, h: s }
        start = [x + w, y]
        end = [x + w - s, y + s]
        w -= s
        break
      case 'bottom':
        square = { x, y: y + h - s, w: s, h: s }
        start = [x + s, y + h]
        end = [x, y + h - s]
        h -= s
        break
      default: {
        const _never: never = cut
        return _never
      }
    }

    arcs.push({ start, end, radius: s, square, cut })
    cut = nextCut(cut)
  }
  return arcs
}

/** SVG path for whirling-square arcs — one M, then chained A commands. */
export function goldenSpiralPathFromArcs(arcs: SpiralArc[]): string {
  if (arcs.length === 0) return ''
  const first = arcs[0]
  const parts = [`M ${first.start[0].toFixed(2)} ${first.start[1].toFixed(2)}`]
  for (const arc of arcs) {
    parts.push(
      `A ${arc.radius.toFixed(2)} ${arc.radius.toFixed(2)} 0 0 1 ${arc.end[0].toFixed(2)} ${arc.end[1].toFixed(2)}`,
    )
  }
  return parts.join(' ')
}

export function goldenSpiralPath(rect: Rect): string {
  return goldenSpiralPathFromArcs(goldenSpiralArcs(rect))
}

export type FrameSpiralArc = {
  start: [number, number]
  end: [number, number]
  rx: number
  ry: number
  square: Rect
  cut: SpiralCut
}

function phiSourceRect(width: number, height: number): { src: Rect; sx: number; sy: number } {
  if (width >= height) {
    const src = { x: 0, y: 0, w: PHI * height, h: height }
    return { src, sx: width / src.w, sy: 1 }
  }
  const src = { x: 0, y: 0, w: width, h: PHI * width }
  return { src, sx: 1, sy: height / src.h }
}

/**
 * True φ spiral scaled onto the film gate. Quarter-circles become axis-aligned
 * ellipses so the curve starts on a frame corner and fills 16:9 / 9:16.
 */
export function goldenSpiralArcsForFrame(width: number, height: number): FrameSpiralArc[] {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const { src, sx, sy } = phiSourceRect(w, h)
  return goldenSpiralArcs(src).map((arc) => ({
    start: [arc.start[0] * sx, arc.start[1] * sy],
    end: [arc.end[0] * sx, arc.end[1] * sy],
    rx: arc.radius * sx,
    ry: arc.radius * sy,
    square: {
      x: arc.square.x * sx,
      y: arc.square.y * sy,
      w: arc.square.w * sx,
      h: arc.square.h * sy,
    },
    cut: arc.cut,
  }))
}

export function goldenSpiralPathFromFrameArcs(arcs: FrameSpiralArc[]): string {
  if (arcs.length === 0) return ''
  const first = arcs[0]
  const parts = [`M ${first.start[0].toFixed(2)} ${first.start[1].toFixed(2)}`]
  for (const arc of arcs) {
    parts.push(
      `A ${arc.rx.toFixed(2)} ${arc.ry.toFixed(2)} 0 0 1 ${arc.end[0].toFixed(2)} ${arc.end[1].toFixed(2)}`,
    )
  }
  return parts.join(' ')
}
