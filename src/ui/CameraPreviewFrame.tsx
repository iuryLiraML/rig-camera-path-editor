import { useLayoutEffect, useRef } from 'react'
import { useCameraReady } from '../state/cameraPathLink'
import { useEditorStore } from '../state/useEditorStore'
import { leafList, useLayoutStore } from '../state/useLayoutStore'
import { exportDimensions } from '../lib/recorder'
import { clampPipRect, useViewportInsets } from './viewportInsets'
import { CameraIcon } from './icons'
import { useCameraOptionsStore } from '../state/useCameraOptionsStore'

const MIN_FRACTION = 0.12
const MAX_FRACTION = 0.5

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * HTML frame around the picture-in-picture region. The pixels themselves are
 * drawn on the main canvas by CameraPreview — this only draws the border,
 * label and controls, at exactly the same position (driven by editor.pipRect).
 * The title bar is a drag handle; the bottom-left grip resizes.
 */
export function CameraPreviewFrame() {
  const showPreview = useEditorStore((s) => s.showPreview)
  const setShowPreview = useEditorStore((s) => s.setShowPreview)
  const playMode = useEditorStore((s) => s.playMode)
  const cameraView = useEditorStore((s) => s.cameraView)
  const exportAspect = useEditorStore((s) => s.exportAspect)
  const exportRes = useEditorStore((s) => s.exportRes)
  const customSize = useEditorStore((s) => s.customSize)
  const pipRect = useEditorStore((s) => s.pipRect)
  const hasPath = useCameraReady()
  const singlePane = useLayoutStore((s) => leafList(s.root).length <= 1)
  const insets = useViewportInsets()
  const displayRect = clampPipRect(pipRect, insets, window.innerWidth, window.innerHeight)
  const activeCameraName = useCameraOptionsStore(
    (s) => s.options.find((option) => option.id === s.activeOptionId)?.name ?? 'Camera',
  )

  // drag state: the pointer origin and the pipRect at grab time
  const drag = useRef<{
    mode: 'move' | 'resize'
    x: number
    y: number
    right: number
    bottom: number
    fraction: number
  } | null>(null)

  // Reclamp when chrome changes *or* when a project hydrate restores an old
  // pipRect that would sit under the Director / timeline.
  useLayoutEffect(() => {
    if (
      displayRect.right === pipRect.right &&
      displayRect.bottom === pipRect.bottom
    ) {
      return
    }
    useEditorStore.getState().setPipRect(displayRect)
  }, [displayRect.right, displayRect.bottom, pipRect.right, pipRect.bottom])

  // in a split layout the panes replace the PiP's job
  if (!hasPath || playMode || !singlePane) return null
  // look-through is full-bleed cinema — the editor PiP would sit on the take
  if (cameraView) return null

  if (!showPreview) {
    return (
      <button
        onClick={() => setShowPreview(true)}
        title="Show the camera view"
        className="panel absolute z-20 flex items-center gap-2 px-3 py-2 text-[11px] text-ink-dim hover:text-ink"
        style={{ right: displayRect.right, bottom: displayRect.bottom }}
      >
        <CameraIcon />
        {activeCameraName}
      </button>
    )
  }

  const vw = window.innerWidth
  const vh = window.innerHeight

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const ddx = e.clientX - d.x
    const ddy = e.clientY - d.y
    if (d.mode === 'move') {
      useEditorStore
        .getState()
        .setPipRect(
          clampPipRect(
            { ...pipRect, right: d.right - ddx, bottom: d.bottom - ddy },
            insets,
            vw,
            vh,
          ),
        )
    } else {
      // bottom-left grip: dragging left/up grows the square (anchored bottom-right)
      const fraction = clamp(d.fraction - ddx / vw, MIN_FRACTION, MAX_FRACTION)
      useEditorStore.getState().setPipRect(clampPipRect({ ...pipRect, fraction }, insets, vw, vh))
    }
  }

  const start = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.stopPropagation()
    drag.current = {
      mode,
      x: e.clientX,
      y: e.clientY,
      right: pipRect.right,
      bottom: pipRect.bottom,
      fraction: pipRect.fraction,
    }
    try {
      ;(e.target as Element).setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer */
    }
  }

  const end = (e: React.PointerEvent) => {
    drag.current = null
    try {
      ;(e.target as Element).releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already gone */
    }
  }

  return (
    <div
      className="pointer-events-none absolute z-20 overflow-hidden rounded-md border border-line shadow-lg"
      style={{
        right: displayRect.right,
        bottom: displayRect.bottom,
        width: `${displayRect.fraction * 100}%`,
        height: `${displayRect.fraction * 100}%`,
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {(() => {
          const [tw, th] = exportDimensions(exportAspect, exportRes, customSize)
          const target = tw / th
          const box = vw / vh // PiP shares the canvas aspect
          const style =
            target < box
              ? { height: '100%', width: `${(target / box) * 100}%` }
              : { width: '100%', height: `${(box / target) * 100}%` }
          return (
            <div
              className="border border-white/40"
              style={{ ...style, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)' }}
            />
          )
        })()}
      </div>
      <button
        onClick={() => useEditorStore.getState().setCameraView(true)}
        title="Look through this camera (Esc to leave)"
        className="pointer-events-auto absolute inset-0 cursor-zoom-in"
      />
      {/* title bar = drag handle */}
      <div
        onPointerDown={start('move')}
        onPointerMove={onMove}
        onPointerUp={end}
        className="pointer-events-auto absolute left-0 right-0 top-0 flex cursor-move items-center justify-between rounded-t-md bg-panel/85 px-2 py-1 backdrop-blur-sm"
      >
        <span className="flex items-center gap-1.5 text-[10px] text-ink-dim">
          <CameraIcon size={11} />
          {activeCameraName}
        </span>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => useEditorStore.getState().setShowPreview(false)}
          title="Hide"
          className="text-[11px] leading-none text-ink-dim hover:text-ink"
        >
          ×
        </button>
      </div>
      {/* bottom-left resize grip */}
      <div
        onPointerDown={start('resize')}
        onPointerMove={onMove}
        onPointerUp={end}
        title="Resize"
        className="pointer-events-auto absolute bottom-0 left-0 h-4 w-4 cursor-nesw-resize"
        style={{
          background:
            'linear-gradient(45deg, rgb(255 255 255 / 0.55) 0 2px, transparent 2px 4px, rgb(255 255 255 / 0.55) 4px 6px, transparent 6px 8px)',
        }}
      />
    </div>
  )
}
