import { SHORTCUT_ROWS } from '../lib/editorShortcuts'
import { useEditorStore } from '../state/useEditorStore'
import { GUTTER, useViewportInsets } from './viewportInsets'

export function NavLegend() {
  const insets = useViewportInsets()
  const compose = useEditorStore((s) => s.workspaceMode === 'compose')
  return (
    <div
      className="pointer-events-none absolute z-20 flex flex-wrap items-center gap-3 text-[10px] text-ink-dim"
      style={{ left: insets.left, bottom: insets.bottom + GUTTER, right: insets.right }}
    >
      <span>Orbit · LMB</span>
      <span>Pan · RMB / MMB</span>
      <span>Zoom · Scroll</span>
      <span>Frame · F</span>
      <span>Origin · H</span>
      {compose &&
        SHORTCUT_ROWS.slice(0, 6).map((row) => (
          <span key={row.keys}>
            {row.action.split(' (')[0]} · {row.keys}
          </span>
        ))}
      <button
        type="button"
        title="Keyboard shortcuts (?)"
        className="pointer-events-auto rounded-md px-1 py-0.5 text-ink-dim hover:bg-panel-2 hover:text-ink"
        onClick={() => useEditorStore.getState().toggleShortcuts()}
      >
        ? shortcuts
      </button>
    </div>
  )
}
