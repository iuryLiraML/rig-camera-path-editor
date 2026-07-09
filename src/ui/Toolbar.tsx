import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { openImportDialog } from '../lib/sceneIO'
import { downloadRigJSON, useRigStore } from '../state/useRigStore'
import { usePathStore, selectCameraAnchorCount } from '../state/usePathStore'
import { exportDimensions, exportFrame, exportVideo } from '../lib/recorder'
import type { ViewMode } from '../state/useEditorStore'
import { PRIMITIVE_DEFS, PRIMITIVE_KINDS } from '../lib/primitiveGeometry'
import { Segmented } from './primitives'
import { CameraIcon, CursorIcon, ImportIcon, PenIcon, PlayIcon, PlusIcon } from './icons'

function ToolButton({
  children,
  active = false,
  disabled = false,
  title,
  onClick,
}: {
  children: ReactNode
  active?: boolean
  disabled?: boolean
  title: string
  onClick?: () => void
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-accent text-white'
          : disabled
            ? 'cursor-not-allowed text-ink-dim/50'
            : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

const Divider = () => <div className="mx-1 h-4 w-px bg-line" />

function AddMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <ToolButton title="Add a shape" active={open} onClick={() => setOpen((v) => !v)}>
        <PlusIcon />
      </ToolButton>
      {open && (
        <div className="panel absolute left-0 top-9 z-30 w-40 p-1">
          <div className="px-2 pb-1 pt-1 text-[10px] font-medium text-ink-dim">Add shape</div>
          {PRIMITIVE_KINDS.map((kind) => (
            <button
              key={kind}
              onClick={() => {
                setOpen(false)
                useSceneStore.getState().addPrimitive(kind)
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-ink hover:bg-panel-2"
            >
              {PRIMITIVE_DEFS[kind].label}
            </button>
          ))}
          <div className="my-1 h-px bg-line/60" />
          <button
            onClick={() => {
              setOpen(false)
              const id = usePathStore.getState().createPath()
              usePathStore.getState().setActivePath(id)
              useEditorStore.getState().setTool('pen')
              useEditorStore.getState().select('camera-path')
            }}
            className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-ink hover:bg-panel-2"
          >
            Path (draw)
          </button>
          <button
            onClick={() => {
              setOpen(false)
              openImportDialog()
            }}
            className="w-full rounded-md px-2 py-1.5 text-left text-[11px] text-ink hover:bg-panel-2"
          >
            Import .glb…
          </button>
        </div>
      )}
    </div>
  )
}

const PASSES: { value: ViewMode; label: string }[] = [
  { value: 'clay', label: 'Clay' },
  { value: 'depth', label: 'Depth' },
  { value: 'outline', label: 'Outline' },
  { value: 'normals', label: 'Normals' },
]

function ExportMenu({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const exportAspect = useEditorStore((s) => s.exportAspect)
  const exportRes = useEditorStore((s) => s.exportRes)
  const customSize = useEditorStore((s) => s.customSize)
  const exportPasses = useEditorStore((s) => s.exportPasses)
  const setExportAspect = useEditorStore((s) => s.setExportAspect)
  const setExportRes = useEditorStore((s) => s.setExportRes)
  const toggleExportPass = useEditorStore((s) => s.toggleExportPass)
  const [outW, outH] = exportDimensions(exportAspect, exportRes, customSize)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        title={disabled ? 'Create a path first' : 'Export video or camera rig'}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md px-3 py-1 text-[11px] ${
          disabled
            ? 'cursor-not-allowed bg-panel-3 text-ink-dim/60'
            : open
              ? 'bg-accent text-white'
              : 'bg-panel-3 text-ink hover:bg-panel-2'
        }`}
      >
        Export
      </button>
      {open && (
        <div className="panel absolute left-1/2 top-9 z-30 w-56 -translate-x-1/2 p-2">
          <div className="mb-1.5 text-[10px] font-medium text-ink-dim">Format</div>
          {exportRes !== 'custom' && (
            <Segmented
              options={[
                { value: '16:9', label: '16:9' },
                { value: '1:1', label: '1:1' },
                { value: '9:16', label: '9:16' },
              ]}
              value={exportAspect}
              onChange={setExportAspect}
            />
          )}
          <div className="mt-1.5">
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
          <div className="mt-1 text-[10px] text-ink-dim">
            {outW} × {outH}px{exportRes === 'custom' && ' — set in Camera › Format'}
          </div>

          <div className="mb-1.5 mt-2 text-[10px] font-medium text-ink-dim">Passes</div>
          <div className="grid grid-cols-2 gap-1">
            {PASSES.map((pass) => {
              const on = exportPasses.includes(pass.value)
              return (
                <button
                  key={pass.value}
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

          <button
            onClick={() => {
              setOpen(false)
              void exportVideo()
            }}
            disabled={exportPasses.length === 0}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-2 py-1.5 text-[11px] font-medium text-white hover:bg-accent/85 disabled:cursor-not-allowed disabled:bg-panel-3 disabled:text-ink-dim/60"
          >
            <CameraIcon />
            Export video (.mp4)
          </button>
          <button
            onClick={() => {
              setOpen(false)
              void exportFrame()
            }}
            disabled={exportPasses.length === 0}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-md bg-panel-2 px-2 py-1.5 text-[11px] text-ink hover:bg-panel-3 disabled:cursor-not-allowed disabled:text-ink-dim/60"
            title="Exports the current playhead frame as PNG, one file per pass"
          >
            Export frame (.png)
          </button>
          <button
            onClick={() => {
              setOpen(false)
              downloadRigJSON()
              useSceneStore.getState().showNotice('camera-rig.json exported')
            }}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-md bg-panel-2 px-2 py-1.5 text-[11px] text-ink hover:bg-panel-3"
          >
            <ImportIcon />
            Camera rig (.json)
          </button>
        </div>
      )}
    </div>
  )
}

export function Toolbar() {
  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)
  const zoomPct = useEditorStore((s) => s.zoomPct)
  const hasPath = usePathStore(selectCameraAnchorCount) >= 2

  const enterPlay = () => {
    if (!hasPath) return
    useEditorStore.getState().setPlayMode(true)
    useRigStore.getState().setPlaying(true)
  }

  return (
    <div className="panel absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-0.5 px-1.5 py-1">
      <AddMenu />
      <Divider />
      <ToolButton title="Select (V)" active={tool === 'select'} onClick={() => setTool('select')}>
        <CursorIcon />
      </ToolButton>
      <ToolButton
        title="Pen — draw the camera path (P)"
        active={tool === 'pen'}
        onClick={() => setTool('pen')}
      >
        <PenIcon />
      </ToolButton>
      <ToolButton title="Import .glb model" onClick={openImportDialog}>
        <ImportIcon />
      </ToolButton>
      <Divider />
      <button
        title="Click to frame the scene (F)"
        onClick={() => useEditorStore.getState().requestFrame()}
        className="w-11 px-1 text-center text-[11px] tabular-nums text-ink-dim hover:text-ink"
      >
        {zoomPct}%
      </button>
      <Divider />
      <ExportMenu disabled={!hasPath} />
      <ToolButton
        title={hasPath ? 'Play fullscreen' : 'Create a path first'}
        disabled={!hasPath}
        onClick={enterPlay}
      >
        <PlayIcon />
      </ToolButton>
    </div>
  )
}
