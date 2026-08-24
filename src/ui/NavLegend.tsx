import { useEditorStore } from '../state/useEditorStore'
import { AXIS_GIZMO_RADIUS, GUTTER, useViewportInsets } from './viewportInsets'

/**
 * Build-only help chip, parked to the right of the axis gizmo. Compose puts
 * `?` on the footer row so this band does not sit on the shading pills.
 */
export function NavLegend() {
  const insets = useViewportInsets()
  const compose = useEditorStore((s) => s.workspaceMode === 'compose')
  const cameraView = useEditorStore((s) => s.cameraView)
  if (cameraView || compose) return null
  return (
    <div
      className="pointer-events-auto absolute z-20"
      style={{
        left: insets.left + AXIS_GIZMO_RADIUS * 2 + GUTTER,
        bottom: insets.contentBottom,
      }}
    >
      <button
        type="button"
        title="Keyboard shortcuts (?)"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-panel/90 text-[12px] text-ink-dim shadow-lg backdrop-blur hover:bg-panel-2 hover:text-ink"
        onClick={() => useEditorStore.getState().toggleShortcuts()}
      >
        ?
      </button>
    </div>
  )
}
