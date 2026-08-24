import { useEffect, useRef, useState } from 'react'
import { exportDimensions, exportFrame, exportVideo } from '../lib/recorder'
import { downloadRigJSON } from '../state/useRigStore'
import { useEditorStore, type ViewMode } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { Segmented } from './primitives'
import { CameraIcon, ExportIcon } from './icons'

export const EXPORT_PASSES: { value: ViewMode; label: string }[] = [
  { value: 'clay', label: 'Clay' },
  { value: 'depth', label: 'Depth' },
  { value: 'outline', label: 'Outline' },
  { value: 'normals', label: 'Normals' },
]

export function ExportFormatFields({ compact = false }: { compact?: boolean }) {
  const exportAspect = useEditorStore((s) => s.exportAspect)
  const exportRes = useEditorStore((s) => s.exportRes)
  const customSize = useEditorStore((s) => s.customSize)
  const setExportAspect = useEditorStore((s) => s.setExportAspect)
  const setExportRes = useEditorStore((s) => s.setExportRes)
  const [outW, outH] = exportDimensions(exportAspect, exportRes, customSize)

  return (
    <div className={compact ? 'flex shrink-0 items-center gap-1.5' : undefined}>
      {!compact && <div className="mb-1.5 text-[10px] font-medium text-ink-dim">Format</div>}
      {exportRes !== 'custom' && (
        <div className={compact ? 'w-[9.5rem] shrink-0' : undefined}>
          <Segmented
            options={[
              { value: '16:9', label: '16:9' },
              { value: '1:1', label: '1:1' },
              { value: '9:16', label: '9:16' },
            ]}
            value={exportAspect}
            onChange={setExportAspect}
          />
        </div>
      )}
      <div className={compact ? 'w-[10.5rem] shrink-0' : 'mt-1.5'}>
        <Segmented
          options={[
            { value: '720', label: '720p' },
            { value: '1080', label: '1080p' },
            { value: 'custom', label: 'Custom' },
          ]}
          value={String(exportRes)}
          onChange={(v) => setExportRes(v === 'custom' ? 'custom' : (Number(v) as 720 | 1080))}
        />
      </div>
      <div className={`shrink-0 text-[10px] text-ink-dim ${compact ? '' : 'mt-1'}`}>
        {outW} × {outH}px{exportRes === 'custom' && ' — set in Camera › Format'}
      </div>
    </div>
  )
}

export function ExportPassToggles({ compact = false }: { compact?: boolean }) {
  const exportPasses = useEditorStore((s) => s.exportPasses)
  const toggleExportPass = useEditorStore((s) => s.toggleExportPass)

  return (
    <div>
      {!compact && <div className="mb-1.5 mt-2 text-[10px] font-medium text-ink-dim">Passes</div>}
      <div className={compact ? 'flex flex-wrap gap-1' : 'grid grid-cols-2 gap-1'}>
        {EXPORT_PASSES.map((pass) => {
          const on = exportPasses.includes(pass.value)
          return (
            <button
              key={pass.value}
              type="button"
              onClick={() => toggleExportPass(pass.value)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] ${
                on ? 'bg-panel-2 text-ink' : 'text-ink-dim hover:text-ink'
              }`}
            >
              <span
                className={`flex h-3 w-3 items-center justify-center rounded-[3px] border text-[8px] ${
                  on ? 'border-accent bg-accent text-white' : 'border-line'
                }`}
              >
                {on ? '✓' : ''}
              </span>
              {pass.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Compact aspect + resolution chips for the Visualize review bar. */
export function ExportFormatPills() {
  const exportAspect = useEditorStore((s) => s.exportAspect)
  const exportRes = useEditorStore((s) => s.exportRes)
  const customSize = useEditorStore((s) => s.customSize)
  const setExportAspect = useEditorStore((s) => s.setExportAspect)
  const setExportRes = useEditorStore((s) => s.setExportRes)
  const [outW, outH] = exportDimensions(exportAspect, exportRes, customSize)

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {exportRes !== 'custom' &&
        (['16:9', '1:1', '9:16'] as const).map((aspect) => (
          <button
            key={aspect}
            type="button"
            onClick={() => setExportAspect(aspect)}
            className={`rounded-md px-2 py-1 text-[11px] ${
              exportAspect === aspect ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
            }`}
          >
            {aspect}
          </button>
        ))}
      {([720, 1080] as const).map((res) => (
        <button
          key={res}
          type="button"
          onClick={() => setExportRes(res)}
          className={`rounded-md px-2 py-1 text-[11px] ${
            exportRes === res ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
          }`}
        >
          {res}p
        </button>
      ))}
      <span className="pl-1 text-[10px] tabular-nums text-ink-dim">
        {outW} × {outH}
      </span>
    </div>
  )
}

/** Frame.io-style overflow for export passes — avoids repeating Clay/Depth/Outline on the bar. */
export function ExportPassesMenu() {
  const [open, setOpen] = useState(false)
  const exportPasses = useEditorStore((s) => s.exportPasses)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const label =
    exportPasses.length === 0
      ? 'Passes'
      : exportPasses.length === EXPORT_PASSES.length
        ? 'All passes'
        : `Passes · ${exportPasses.length}`

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        title="Passes included in the export"
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md px-2 py-1 text-[11px] ${
          open ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
        }`}
      >
        {label}
      </button>
      {open && (
        <div className="panel absolute bottom-8 right-0 z-30 w-40 p-1.5">
          <ExportPassToggles />
        </div>
      )}
    </div>
  )
}

export function ExportActions({
  onDone,
  includeRig = true,
  compact = false,
}: {
  onDone?: () => void
  includeRig?: boolean
  compact?: boolean
}) {
  const exportPasses = useEditorStore((s) => s.exportPasses)
  const disabled = exportPasses.length === 0

  return (
    <div className={compact ? 'flex shrink-0 items-center gap-1.5' : undefined}>
      <button
        type="button"
        onClick={() => {
          onDone?.()
          void exportVideo()
        }}
        disabled={disabled}
        className={
          compact
            ? 'flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent/85 disabled:cursor-not-allowed disabled:bg-panel-3 disabled:text-ink-dim/60'
            : 'mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-2 py-1.5 text-[11px] font-medium text-white hover:bg-accent/85 disabled:cursor-not-allowed disabled:bg-panel-3 disabled:text-ink-dim/60'
        }
      >
        <CameraIcon />
        Export video
        {!compact && ' (.mp4)'}
      </button>
      <button
        type="button"
        onClick={() => {
          onDone?.()
          void exportFrame()
        }}
        disabled={disabled}
        title="Exports the current playhead frame as PNG, one file per pass"
        className={
          compact
            ? 'rounded-md bg-panel-2 px-2 py-1 text-[11px] text-ink hover:bg-panel-3 disabled:cursor-not-allowed disabled:text-ink-dim/60'
            : 'mt-1 flex w-full items-center justify-center gap-2 rounded-md bg-panel-2 px-2 py-1.5 text-[11px] text-ink hover:bg-panel-3 disabled:cursor-not-allowed disabled:text-ink-dim/60'
        }
      >
        Export frame
        {!compact && ' (.png)'}
      </button>
      {includeRig && (
        <button
          type="button"
          onClick={() => {
            onDone?.()
            downloadRigJSON()
            useSceneStore.getState().showNotice('camera-rig.json exported')
          }}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-md bg-panel-2 px-2 py-1.5 text-[11px] text-ink hover:bg-panel-3"
        >
          <ExportIcon />
          Camera rig (.json)
        </button>
      )}
    </div>
  )
}
