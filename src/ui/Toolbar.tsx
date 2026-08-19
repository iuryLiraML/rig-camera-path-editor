import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useCameraReady } from '../state/cameraPathLink'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { downloadRigJSON } from '../state/useRigStore'
import { applyBeginPlayback } from '../lib/playback'
import { exportDimensions, exportFrame, exportVideo } from '../lib/recorder'
import type { ViewMode } from '../state/useEditorStore'
import { Segmented } from './primitives'
import { AddSceneMenu } from './AddSceneMenu'
import { CameraIcon, CursorIcon, ExportIcon, PenIcon, PlayIcon } from './icons'
import { toolbarSlot, useViewportInsets, useWindowSize } from './viewportInsets'

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

function MagnetIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3v7a6 6 0 0 0 12 0V3" />
      <line x1="6" y1="3" x2="10" y2="3" />
      <line x1="14" y1="3" x2="18" y2="3" />
      <line x1="6" y1="10" x2="10" y2="10" />
      <line x1="14" y1="10" x2="18" y2="10" />
    </svg>
  )
}

function SnapControls() {
  const snapEnabled = useEditorStore((s) => s.snapEnabled)
  const gridSize = useEditorStore((s) => s.gridSize)
  const toggleSnap = useEditorStore((s) => s.toggleSnap)
  const setGridSize = useEditorStore((s) => s.setGridSize)
  return (
    <>
      <ToolButton
        title="Snap points to the grid — hold Ctrl to invert while drawing"
        active={snapEnabled}
        onClick={toggleSnap}
      >
        <MagnetIcon />
      </ToolButton>
      <select
        title="Grid cell size"
        value={gridSize}
        onChange={(e) => setGridSize(Number(e.target.value))}
        className="h-7 rounded-md bg-panel-3 px-1 text-[11px] text-ink hover:bg-panel-2"
      >
        <option value={0.25}>0.25</option>
        <option value={0.5}>0.5</option>
        <option value={1}>1</option>
      </select>
    </>
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
            <ExportIcon />
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
  const gizmoMode = useEditorStore((s) => s.gizmoMode)
  const selection = useEditorStore((s) => s.selection)
  const zoomPct = useEditorStore((s) => s.zoomPct)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const hasPath = useCameraReady()
  const insets = useViewportInsets()
  const win = useWindowSize()
  const slot = toolbarSlot(insets, win.w)
  const scaleLocked = selection === 'cinema-camera'
  const sceneTools = workspaceMode !== 'visualize'
  const composeTools = workspaceMode === 'compose'

  const enterPlay = () => {
    if (!hasPath) return
    useEditorStore.getState().setPlayMode(true)
    applyBeginPlayback()
  }

  const pickGizmo = (mode: 'translate' | 'rotate' | 'scale') => {
    setTool('select')
    useEditorStore.getState().setGizmoMode(mode)
  }

  return (
    <div
      className="panel absolute top-3 z-20 flex w-max items-center justify-center gap-0.5 px-1.5 py-1"
      style={{ right: slot.right }}
    >
      {sceneTools && (
        <>
          {composeTools && (
            <AddSceneMenu includePath title="Add a shape, path, or import a model" />
          )}
          {composeTools && <Divider />}
          <ToolButton title="Select (V)" active={tool === 'select'} onClick={() => setTool('select')}>
            <CursorIcon />
          </ToolButton>
          {composeTools && (
            <ToolButton
              title="Pen — draw the camera path (P)"
              active={tool === 'pen'}
              onClick={() => setTool('pen')}
            >
              <PenIcon />
            </ToolButton>
          )}
          <Divider />
          <div className="flex items-center gap-px px-0.5">
          <ToolButton
            title="Move (W)"
            active={tool === 'select' && gizmoMode === 'translate'}
            onClick={() => pickGizmo('translate')}
          >
            <span className="text-[10px] font-semibold">W</span>
          </ToolButton>
          <ToolButton
            title="Rotate (E)"
            active={tool === 'select' && gizmoMode === 'rotate'}
            onClick={() => pickGizmo('rotate')}
          >
            <span className="text-[10px] font-semibold">E</span>
          </ToolButton>
          <ToolButton
            title={scaleLocked ? 'Scale does not apply to the camera' : 'Scale (R)'}
            active={tool === 'select' && gizmoMode === 'scale'}
            disabled={scaleLocked}
            onClick={() => pickGizmo('scale')}
          >
            <span className="text-[10px] font-semibold">R</span>
          </ToolButton>
          </div>
          {tool === 'pen' && composeTools && (
            <>
              <Divider />
              <SnapControls />
            </>
          )}
          <Divider />
        </>
      )}
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
        title={hasPath ? 'Fullscreen preview (hides panels)' : 'Create a path first'}
        disabled={!hasPath}
        onClick={enterPlay}
      >
        <PlayIcon />
      </ToolButton>
    </div>
  )
}
