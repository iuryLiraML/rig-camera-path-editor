import { SHORTCUT_ROWS } from '../lib/editorShortcuts'
import { useEditorStore } from '../state/useEditorStore'

export function ShortcutsOverlay() {
  const open = useEditorStore((s) => s.showShortcuts)
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => useEditorStore.getState().setShowShortcuts(false)}
    >
      <div
        className="panel w-[min(92vw,420px)] p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Keyboard shortcuts</h2>
          <button
            type="button"
            title="Close (Esc)"
            onClick={() => useEditorStore.getState().setShowShortcuts(false)}
            className="rounded-md px-1.5 py-0.5 text-[13px] text-ink-dim hover:bg-panel-2 hover:text-ink"
          >
            ×
          </button>
        </div>
        <ul className="flex flex-col gap-1.5">
          {SHORTCUT_ROWS.map((row) => (
            <li key={row.keys} className="flex items-baseline justify-between gap-3 text-[11px]">
              <kbd className="shrink-0 rounded bg-panel-3 px-1.5 py-0.5 font-sans text-[10px] text-ink">
                {row.keys}
              </kbd>
              <span className="text-ink-dim">{row.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
