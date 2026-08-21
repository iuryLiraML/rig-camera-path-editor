import { useEffect, useRef, useState } from 'react'
import { easeDef, easeGroups, type EaseKind } from '../lib/easing'

/**
 * Compact curve picker. A native <select> of every Penner family is taller
 * than the viewport and paints over the 3D scene; this menu opens upward
 * and scrolls.
 */
export function EasePicker({
  value,
  onChange,
  title,
}: {
  value: EaseKind
  onChange: (ease: EaseKind) => void
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = easeDef(value)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        data-key-ease
        title={title ?? current.hint}
        onClick={() => setOpen((on) => !on)}
        className="flex max-w-[11rem] items-center gap-1 rounded-md bg-panel-2 px-1.5 py-0.5 text-left text-[11px] text-ink hover:bg-panel-3"
      >
        <span className="truncate">{current.label}</span>
        <span className="text-[9px] text-ink-dim">▴</span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-1 max-h-56 w-[16rem] overflow-y-auto rounded-md border border-line bg-panel py-1 shadow-lg">
          {easeGroups().map((group) => (
            <div key={group.group}>
              <div className="px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-ink-dim">
                {group.group}
              </div>
              {group.items.map((item) => {
                const on = item.kind === value
                return (
                  <button
                    key={item.kind}
                    type="button"
                    title={item.hint || item.label}
                    onClick={() => {
                      onChange(item.kind)
                      setOpen(false)
                    }}
                    className={`block w-full truncate px-2 py-1 text-left text-[11px] ${
                      on ? 'bg-accent text-white' : 'text-ink hover:bg-panel-2'
                    }`}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
