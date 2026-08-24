import { useMemo } from 'react'
import {
  containRect,
  goldenLines,
  goldenSpiralArcsForFrame,
  goldenSpiralPathFromFrameArcs,
  safeInsets,
  thirdsLines,
  type CompositionGuides,
} from '../lib/compositionGuides'

const STROKE = 'rgb(255 255 255 / 0.42)'
const STROKE_DIM = 'rgb(255 255 255 / 0.22)'
const STROKE_SPIRAL = 'rgb(255 255 255 / 0.72)'

function CrossLines({
  x,
  y,
  color = STROKE,
}: {
  x: [number, number]
  y: [number, number]
  color?: string
}) {
  return (
    <>
      {x.map((v) => (
        <line
          key={`x-${v}`}
          x1={`${v * 100}%`}
          y1="0"
          x2={`${v * 100}%`}
          y2="100%"
          stroke={color}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {y.map((v) => (
        <line
          key={`y-${v}`}
          x1="0"
          y1={`${v * 100}%`}
          x2="100%"
          y2={`${v * 100}%`}
          stroke={color}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  )
}

function GateGuides({
  width,
  height,
  guides,
}: {
  width: number
  height: number
  guides: CompositionGuides
}) {
  const thirds = thirdsLines()
  const golden = goldenLines()
  const safe = safeInsets()
  const spiralArcs = useMemo(() => {
    if (!guides.spiral || width < 8 || height < 8) return []
    return goldenSpiralArcsForFrame(width, height)
  }, [guides.spiral, width, height])
  const spiral = useMemo(() => goldenSpiralPathFromFrameArcs(spiralArcs), [spiralArcs])

  return (
    <>
      {guides.safe && (
        <>
          <rect
            x={`${safe.action * 100}%`}
            y={`${safe.action * 100}%`}
            width={`${(1 - safe.action * 2) * 100}%`}
            height={`${(1 - safe.action * 2) * 100}%`}
            fill="none"
            stroke={STROKE_DIM}
            strokeDasharray="6 5"
          />
          <rect
            x={`${safe.title * 100}%`}
            y={`${safe.title * 100}%`}
            width={`${(1 - safe.title * 2) * 100}%`}
            height={`${(1 - safe.title * 2) * 100}%`}
            fill="none"
            stroke={STROKE}
            strokeDasharray="3 4"
          />
        </>
      )}
      {guides.thirds && <CrossLines x={thirds.x} y={thirds.y} />}
      {guides.golden && <CrossLines x={golden.x} y={golden.y} color={STROKE_DIM} />}
      {guides.spiral && spiral && (
        <>
          {spiralArcs.map((arc, i) =>
            Math.min(arc.square.w, arc.square.h) < 12 ? null : (
              <rect
                key={`sq-${arc.cut}-${i}`}
                x={arc.square.x}
                y={arc.square.y}
                width={arc.square.w}
                height={arc.square.h}
                fill="none"
                stroke={STROKE_DIM}
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}
          <path
            d={spiral}
            fill="none"
            stroke={STROKE_SPIRAL}
            strokeWidth={2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </>
  )
}

/**
 * On-lens composition overlay for look-through. Guides sit on the export
 * film gate (letterboxed in the free area), not on the leftover chrome hole.
 */
export function CompositionOverlay({
  width,
  height,
  aspect,
  guides,
}: {
  width: number
  height: number
  /** Export frame width/height. Guides compose that rectangle. */
  aspect: number
  guides: CompositionGuides
}) {
  const gate = useMemo(
    () => containRect(width, height, aspect),
    [width, height, aspect],
  )

  if (!guides.thirds && !guides.golden && !guides.spiral && !guides.safe) return null
  if (width < 8 || height < 8 || gate.w < 8 || gate.h < 8) return null

  return (
    <svg
      data-testid="composition-guides"
      className="pointer-events-none absolute inset-0 z-[11] h-full w-full"
      viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
      preserveAspectRatio="none"
    >
      <rect
        x={gate.x}
        y={gate.y}
        width={gate.w}
        height={gate.h}
        fill="none"
        stroke="rgb(255 255 255 / 0.18)"
        vectorEffect="non-scaling-stroke"
      />
      <svg
        data-testid="film-gate"
        x={gate.x}
        y={gate.y}
        width={gate.w}
        height={gate.h}
        viewBox={`0 0 ${gate.w} ${gate.h}`}
        overflow="visible"
      >
        <GateGuides width={gate.w} height={gate.h} guides={guides} />
      </svg>
    </svg>
  )
}
