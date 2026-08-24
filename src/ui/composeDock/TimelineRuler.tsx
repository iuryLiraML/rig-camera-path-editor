import { useRef, type PointerEvent, type RefObject } from 'react'
import { clampTimeView, timeToX, type TimeView } from '../../lib/timeView'

/** Full-shot overview bar. Drag the window to pan; click outside it to jump. */
export function TimeNavigator({
  view,
  onChange,
}: {
  view: TimeView
  onChange: (view: TimeView) => void
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; start: number } | null>(null)

  return (
    <div className="flex h-3 shrink-0 items-center gap-2 pt-1">
      <div className="w-44 shrink-0" />
      <div
        ref={barRef}
        data-time-navigator
        title="Drag to pan the time view"
        className="relative h-2 min-w-0 flex-1 cursor-pointer rounded-sm bg-panel-2"
        onPointerDown={(e) => {
          const bar = barRef.current
          if (!bar) return
          const rect = bar.getBoundingClientRect()
          const x = (e.clientX - rect.left) / Math.max(1e-6, rect.width)
          let start = view.start
          if (x < view.start || x > view.start + view.span) {
            const next = clampTimeView(x - view.span / 2, view.span)
            onChange(next)
            start = next.start
          }
          drag.current = { x: e.clientX, start }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current || !barRef.current) return
          const dx =
            (e.clientX - drag.current.x) / Math.max(1e-6, barRef.current.getBoundingClientRect().width)
          onChange(clampTimeView(drag.current.start + dx, view.span))
        }}
        onPointerUp={(e) => {
          drag.current = null
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            /* pointer may be gone */
          }
        }}
      >
        <div
          className="absolute top-0 h-full rounded-sm bg-accent/40 ring-1 ring-accent/60"
          style={{ left: `${view.start * 100}%`, width: `${view.span * 100}%` }}
        />
      </div>
      <div className="w-6 shrink-0" />
    </div>
  )
}

export function TimelineRuler({
  rulerRef,
  ticks,
  view,
  onScrubStart,
  onScrub,
  onScrubEnd,
}: {
  rulerRef: RefObject<HTMLDivElement | null>
  ticks: { t: number; major: boolean; label?: string | null }[]
  view: TimeView
  onScrubStart: (e: PointerEvent<HTMLDivElement>) => void
  onScrub: (e: PointerEvent<HTMLDivElement>) => void
  onScrubEnd: (e: PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div className="flex items-stretch gap-2">
      <div className="w-44 shrink-0" />
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div
          ref={rulerRef}
          aria-label="Time ruler"
          title="Drag to scrub · scroll anywhere on the timeline to zoom frames · Shift+scroll to pan"
          className="relative h-7 cursor-col-resize select-none"
          onPointerDown={onScrubStart}
          onPointerMove={onScrub}
          onPointerUp={onScrubEnd}
        >
          {ticks.map((mark, i) => (
            <div
              key={`${mark.t}-${i}`}
              className="absolute bottom-0 top-0"
              style={{ left: `${timeToX(mark.t, view) * 100}%` }}
            >
              <div
                className={`absolute bottom-0 w-px bg-line ${mark.major ? 'h-2.5' : 'h-1.5 opacity-70'}`}
              />
              {mark.label && (
                <span className="absolute bottom-2.5 translate-x-0.5 text-[9px] tabular-nums text-ink-dim">
                  {mark.label}
                </span>
              )}
            </div>
          ))}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-line" />
        </div>
      </div>
      <div className="w-6 shrink-0" />
    </div>
  )
}
