import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { openImportDialog } from '../lib/sceneIO'
import { PRIMITIVE_DEFS, PRIMITIVE_KINDS } from '../lib/primitiveGeometry'
import { useEditorStore } from '../state/useEditorStore'
import { usePathStore } from '../state/usePathStore'
import { useSceneStore } from '../state/useSceneStore'
import { addStaticCamera } from '../lib/addStaticCamera'
import { PlusIcon } from './icons'

/** New motion path, then Pen so the next click in the viewport draws it. */
export function addDrawnPath() {
  const id = usePathStore.getState().createPath()
  usePathStore.getState().setActivePath(id)
  useEditorStore.getState().setTool('pen')
  useEditorStore.getState().select('camera-path')
}

function menuCoords(button: HTMLElement) {
  const r = button.getBoundingClientRect()
  const width = 176
  const left = Math.min(r.left, window.innerWidth - width - 8)
  return { top: r.bottom + 6, left: Math.max(8, left) }
}

/**
 * Add primitives / import GLB onto the active scene's stage. Portaled onto
 * document.body so the toolbar's overflow-x-auto and the left panel's
 * overflow-hidden cannot clip the menu.
 */
export function AddObjectMenu({
  includePath = false,
  compact = false,
  title,
}: {
  includePath?: boolean
  compact?: boolean
  title: string
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const place = () => {
      const button = buttonRef.current
      if (button) setCoords(menuCoords(button))
    }
    const close = (e: PointerEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', place)
    }
  }, [open])

  const closeAnd = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        title={title}
        onClick={() => {
          const button = buttonRef.current
          if (!open && button) setCoords(menuCoords(button))
          setOpen((v) => !v)
        }}
        className={
          compact
            ? `rounded p-0.5 ${open ? 'bg-panel-2 text-ink' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'}`
            : `flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                open ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
              }`
        }
      >
        <PlusIcon size={compact ? 12 : 14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="panel fixed z-50 w-44 p-1"
            style={{ top: coords.top, left: coords.left }}
          >
            <div className="px-2 pb-1 pt-1 text-[10px] font-medium text-ink-dim">Add shape</div>
            {PRIMITIVE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => closeAnd(() => useSceneStore.getState().addPrimitive(kind))}
                className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-ink hover:bg-panel-2"
              >
                {PRIMITIVE_DEFS[kind].label}
              </button>
            ))}
            <div className="my-1 h-px bg-line/60" />
            {includePath && (
              <>
                <button
                  type="button"
                  onClick={() => closeAnd(addDrawnPath)}
                  className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-ink hover:bg-panel-2"
                >
                  Path (draw)
                </button>
                <button
                  type="button"
                  onClick={() => closeAnd(addStaticCamera)}
                  className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-ink hover:bg-panel-2"
                >
                  Free camera
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => closeAnd(openImportDialog)}
              className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-ink hover:bg-panel-2"
            >
              Import .glb…
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
