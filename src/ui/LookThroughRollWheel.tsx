import { useRef } from 'react'
import { evalValue } from '../lib/keyframes'
import { wrapRollDeg, writeRoll } from '../lib/autoKey'
import { useRigStore } from '../state/useRigStore'

const FINE = 0.25

function pointerDeg(el: HTMLElement, clientX: number, clientY: number): number {
  const rect = el.getBoundingClientRect()
  return (
    (Math.atan2(clientY - (rect.top + rect.height / 2), clientX - (rect.left + rect.width / 2)) *
      180) /
    Math.PI
  )
}

/**
 * On-lens dutch control: a wheel around the view axis plus a vertical slider.
 * Writes the cinema roll channel (same axis as look-through).
 */
export function LookThroughRollWheel() {
  const t = useRigStore((s) => s.t)
  const roll = useRigStore((s) => s.roll)
  const rollKeys = useRigStore((s) => s.rollKeys)
  const ease = useRigStore((s) => s.ease)
  const value = wrapRollDeg(evalValue(t, rollKeys, roll, ease))
  const drag = useRef<{ originAngle: number; originRoll: number } | null>(null)

  return (
    <div
      data-testid="look-through-roll"
      className="flex flex-col items-center gap-1 rounded-2xl bg-panel/90 px-2 py-2 shadow-lg backdrop-blur"
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-dim">Roll</span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          aria-label="Roll"
          title="Roll around the view axis"
          min={-180}
          max={180}
          step={1}
          value={Math.round(value)}
          onChange={(e) => writeRoll(Number(e.target.value))}
          className="h-24 w-4 cursor-ns-resize accent-accent"
          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Roll wheel"
          aria-valuemin={-180}
          aria-valuemax={180}
          aria-valuenow={Math.round(value)}
          aria-valuetext={`${Math.round(value)} degrees`}
          title="Drag around the wheel to roll. Double-click to level. Shift for finer."
          className="relative h-[72px] w-[72px] shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = {
              originAngle: pointerDeg(e.currentTarget, e.clientX, e.clientY),
              originRoll: value,
            }
          }}
          onPointerMove={(e) => {
            const start = drag.current
            if (!start) return
            const delta = pointerDeg(e.currentTarget, e.clientX, e.clientY) - start.originAngle
            writeRoll(start.originRoll + delta * (e.shiftKey ? FINE : 1))
          }}
          onPointerUp={() => {
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
          onDoubleClick={() => writeRoll(0)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? FINE : 1
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
              e.preventDefault()
              writeRoll(value + step)
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
              e.preventDefault()
              writeRoll(value - step)
            } else if (e.key === 'Home' || e.key === '0') {
              e.preventDefault()
              writeRoll(0)
            }
          }}
        >
          <svg viewBox="0 0 72 72" className="h-full w-full text-ink">
            <circle
              cx="36"
              cy="36"
              r="33"
              fill="rgb(255 255 255 / 0.04)"
              stroke="rgb(255 255 255 / 0.28)"
              strokeWidth="1.25"
            />
            <circle cx="36" cy="36" r="2" fill="currentColor" opacity="0.7" />
            <g transform={`rotate(${value} 36 36)`}>
              <line
                x1="10"
                y1="36"
                x2="62"
                y2="36"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                opacity="0.92"
              />
              <line
                x1="36"
                y1="14"
                x2="36"
                y2="24"
                stroke="rgb(255 255 255 / 0.55)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </g>
          </svg>
        </div>
      </div>
      <button
        type="button"
        title="Level the horizon (0° roll)"
        onClick={() => writeRoll(0)}
        className="tabular-nums text-[11px] text-ink hover:text-white"
      >
        {`${Math.round(value)}°`}
      </button>
    </div>
  )
}
