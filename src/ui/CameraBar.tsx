import { useEffect, useRef, useState } from 'react'
import { fovFromFocalLength, LENS_PRESETS, nearestLensPreset } from '../lib/lens'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { ListIcon, PathNodesIcon, SettingsIcon } from './icons'
import { useViewportInsets } from './viewportInsets'

export function CameraBar({ embedded = false }: { embedded?: boolean }) {
  const fov = useRigStore((s) => s.fov)
  const cameraPanel = useEditorStore((s) => s.cameraPanel)
  const insets = useViewportInsets()
  const [lensOpen, setLensOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const activeMm = nearestLensPreset(fov)

  useEffect(() => {
    if (!lensOpen) return
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setLensOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [lensOpen])

  return (
    <div
      ref={wrapRef}
      className={`relative flex items-center ${embedded ? '' : 'absolute z-20 -translate-x-1/2'}`}
      style={embedded ? undefined : { left: insets.centre, bottom: insets.bottom + 12 }}
    >
      {lensOpen && (
        <div className="panel absolute bottom-full z-30 mb-2 w-52 p-1">
          {LENS_PRESETS.map((preset) => (
            <button
              key={preset.mm}
              type="button"
              onClick={() => {
                useRigStore.getState().setFov(fovFromFocalLength(preset.mm))
                setLensOpen(false)
              }}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] ${
                preset.mm === activeMm ? 'bg-panel-2 text-ink' : 'text-ink hover:bg-panel-2'
              }`}
            >
              {preset.label}
              {preset.mm === activeMm && <span className="text-[10px] text-accent">✓</span>}
            </button>
          ))}
        </div>
      )}
      <div className="panel flex items-center gap-0.5 px-1.5 py-1">
        <button
          type="button"
          title="Camera adjustments"
          onClick={() => {
            const editor = useEditorStore.getState()
            editor.setCameraPanel(editor.cameraPanel === 'closed' ? 'adjust' : 'closed')
          }}
          className={`flex h-7 w-7 items-center justify-center rounded-md ${
            cameraPanel !== 'closed'
              ? 'bg-panel-3 text-ink'
              : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
          }`}
        >
          <SettingsIcon size={14} />
        </button>
        <button
          type="button"
          title="Lens"
          onClick={() => setLensOpen((v) => !v)}
          className={`rounded-md px-2 py-1 text-[11px] ${
            lensOpen ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
          }`}
        >
          {activeMm}mm
        </button>
        <button
          type="button"
          title="Select the camera path"
          onClick={() => useEditorStore.getState().select('camera-path')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-dim hover:bg-panel-2 hover:text-ink"
        >
          <PathNodesIcon size={14} />
        </button>
        <button
          type="button"
          title="Shot list"
          onClick={() => useEditorStore.getState().setComposeDock('sequence')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-dim hover:bg-panel-2 hover:text-ink"
        >
          <ListIcon size={14} />
        </button>
      </div>
    </div>
  )
}
