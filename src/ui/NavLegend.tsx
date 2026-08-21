import { chromeBand, GUTTER, useViewportInsets, useWindowSize } from './viewportInsets'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'

export function NavLegend() {
  const insets = useViewportInsets()
  const compose = useEditorStore((s) => s.workspaceMode === 'compose')
  const staticCam = useRigStore((s) => s.cameraKind === 'static')
  const win = useWindowSize()
  const band = chromeBand(insets, win.w)
  // Free-camera HUD occupies this band in Compose; keep the legend for path cameras.
  if (compose && staticCam) return null
  return (
    <div
      className="pointer-events-none absolute z-20 flex flex-nowrap items-center gap-3 overflow-hidden text-[10px] text-ink-dim"
      style={{
        left: band.left,
        maxWidth: band.width,
        bottom: compose ? insets.contentBottom : GUTTER,
      }}
    >
      <span>Orbit · LMB</span>
      <span>Pan · RMB / MMB</span>
      <span>Zoom · Scroll</span>
      <span>Frame · F</span>
      <span>Origin · H</span>
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
