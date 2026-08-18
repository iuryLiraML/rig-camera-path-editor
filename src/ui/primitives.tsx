import { useRef, type PointerEvent, type ReactNode } from 'react'
import type { Vec3 } from '../state/useSceneStore'
import {
  NUMBER_SCRUB_THRESHOLD_PX,
  numberScrubScale,
  numberScrubValue,
} from './numberScrub'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-line/60 px-3 py-3 last:border-b-0">
      <div className="mb-2.5 text-[11px] font-medium text-ink-dim">{title}</div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 shrink-0 text-[11px] text-ink-dim">{label}</div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex w-full rounded-md bg-panel-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`flex-1 rounded-[5px] px-2 py-1 text-[11px] transition-colors ${
            value === option.value
              ? 'bg-accent text-white'
              : 'text-ink-dim hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export const KEYED_GREEN = '#3dd68c'

export function NumberInput({
  value,
  onChange,
  step = 0.1,
  prefix,
  keyed = false,
  onFocusChange,
}: {
  value: number
  onChange: (value: number) => void
  step?: number
  prefix?: string
  keyed?: boolean
  onFocusChange?: (on: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startY: number
    startValue: number
    scrubbing: boolean
  } | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startValue: value,
      scrubbing: false,
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const dy = e.clientY - drag.startY
    if (!drag.scrubbing) {
      if (Math.abs(dy) < NUMBER_SCRUB_THRESHOLD_PX) return
      drag.scrubbing = true
      e.currentTarget.setPointerCapture(e.pointerId)
      inputRef.current?.blur()
    }
    e.preventDefault()
    const next = numberScrubValue(
      drag.startValue,
      dy,
      step,
      numberScrubScale(e.shiftKey, e.altKey),
    )
    if (next !== value) onChange(next)
  }

  const endPointer = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    if (drag.scrubbing && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    dragRef.current = null
  }

  return (
    <div
      className={`flex min-w-0 flex-1 cursor-ns-resize select-none items-center gap-1 rounded-md bg-panel-2 px-1.5 py-1 focus-within:cursor-text ${
        keyed ? 'ring-1 ring-[#3dd68c]' : ''
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      {prefix && <span className="text-[10px] text-ink-dim">{prefix}</span>}
      <input
        ref={inputRef}
        type="number"
        step={step}
        value={Number(value.toFixed(3))}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value)
          if (!Number.isNaN(parsed)) onChange(parsed)
        }}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        className={`w-full min-w-0 cursor-ns-resize bg-transparent text-right text-[11px] outline-none focus:cursor-text ${
          keyed ? 'text-[#3dd68c]' : 'text-ink'
        }`}
      />
    </div>
  )
}

export function XYZInput({
  value,
  onChange,
  step = 0.1,
  keyed = false,
  onFocusChange,
}: {
  value: Vec3
  onChange: (axis: 0 | 1 | 2, value: number) => void
  step?: number
  keyed?: boolean
  onFocusChange?: (on: boolean) => void
}) {
  return (
    <div className="flex flex-1 gap-1">
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <NumberInput
          key={axis}
          prefix={axis}
          step={step}
          value={value[i]}
          keyed={keyed}
          onFocusChange={onFocusChange}
          onChange={(v) => onChange(i as 0 | 1 | 2, v)}
        />
      ))}
    </div>
  )
}

export function ColorField({
  value,
  onChange,
}: {
  value: string
  onChange: (hex: string) => void
}) {
  return (
    <div className="flex flex-1 items-center gap-1.5 rounded-md bg-panel-2 px-1.5 py-1">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-4 w-5 shrink-0"
      />
      <input
        type="text"
        value={value.replace('#', '').toUpperCase()}
        onChange={(e) => {
          const hex = e.target.value.trim().replace(/^#/, '')
          if (/^[0-9a-fA-F]{6}$/.test(hex)) onChange(`#${hex.toLowerCase()}`)
        }}
        className="w-full min-w-0 bg-transparent text-[11px] text-ink outline-none"
      />
    </div>
  )
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  format,
  keyed = false,
  onFocusChange,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  format?: (value: number) => string
  keyed?: boolean
  onFocusChange?: (on: boolean) => void
}) {
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-2 ${keyed ? 'rounded-md ring-1 ring-[#3dd68c] px-1' : ''}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        className="w-full min-w-0 flex-1 accent-accent"
      />
      <span
        className={`w-9 shrink-0 text-right text-[11px] tabular-nums ${
          keyed ? 'text-[#3dd68c]' : 'text-ink'
        }`}
      >
        {format ? format(value) : value.toFixed(2)}
      </span>
    </div>
  )
}

export const pct = (v: number) => `${Math.round(v * 100)}%`
export const secs = (v: number) => `${v.toFixed(1)}s`
export const meters = (v: number) => v.toFixed(1)
