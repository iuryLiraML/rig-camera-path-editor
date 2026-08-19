import { saveCurrentAsShot } from '../lib/projects'
import { aspectFromExport } from '../lib/agent/framing'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { GUTTER, useViewportInsets, useWindowSize } from './viewportInsets'

/**
 * Cinema safe-frame overlay — the export aspect, inset from the free viewport.
 */
export function ShotFrame() {
  const aspect = useEditorStore((s) => s.exportAspect)
  const activeShotId = useEditorStore((s) => s.activeShotId)
  const shots = useProjectStore((s) => s.shots)
  const insets = useViewportInsets()
  const win = useWindowSize()
  const ratio = aspectFromExport(aspect)
  const freeW = Math.max(1, insets.right - insets.left - GUTTER * 2)
  const freeH = Math.max(1, win.h - insets.top - insets.bottom - GUTTER * 2)
  let width = freeW
  let height = width / ratio
  if (height > freeH) {
    height = freeH
    width = height * ratio
  }
  const left = insets.left + (insets.right - insets.left - width) / 2
  const top = insets.top + GUTTER + Math.max(0, (freeH - height) / 2)

  const ordered = [...shots].sort((a, b) => a.order - b.order)
  const activeIndex = Math.max(
    0,
    ordered.findIndex((shot) => shot.id === activeShotId),
  )
  const shotNumber = ordered.length === 0 ? 1 : activeIndex + 1
  const canEditShots = ordered.length > 1

  return (
    <div className="pointer-events-none absolute z-10" style={{ left, top, width, height }}>
      <div className="absolute inset-0 rounded-sm border border-white/35" />
      <Corner className="left-0 top-0" />
      <Corner className="right-0 top-0 rotate-90" />
      <Corner className="bottom-0 right-0 rotate-180" />
      <Corner className="bottom-0 left-0 -rotate-90" />
      <div className="pointer-events-auto absolute left-2 top-2 flex items-center gap-1">
        <span className="rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
          Shot {shotNumber}
        </span>
        {canEditShots && (
          <>
            <button
              type="button"
              title="Duplicate this framing as a new shot"
              onClick={() => void saveCurrentAsShot()}
              className="rounded-md bg-black/55 px-2 py-0.5 text-[11px] text-white hover:bg-black/75"
            >
              Duplicate
            </button>
            <button
              type="button"
              title="Remove this shot"
              onClick={() => {
                const id = activeShotId ?? ordered[ordered.length - 1]?.id
                if (!id) return
                const remaining = ordered.filter((shot) => shot.id !== id)
                useProjectStore.getState().removeShot(id)
                useEditorStore.getState().setActiveShotId(remaining[remaining.length - 1]?.id ?? null)
              }}
              className="rounded-md bg-black/55 px-2 py-0.5 text-[11px] text-white hover:bg-black/75"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Corner({ className }: { className: string }) {
  return (
    <span className={`absolute h-4 w-4 border-l-2 border-t-2 border-white/80 ${className}`} />
  )
}
