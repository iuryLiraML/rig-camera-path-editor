import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useCameraReady } from '../state/cameraPathLink'
import { useEditorStore, type QuickView } from '../state/useEditorStore'
import { applyBeginPlayback } from '../lib/playback'
import { openComposeTimeline } from '../lib/editorShortcuts'
import { AddObjectMenu } from './AddObjectMenu'
import { ExportActions, ExportFormatFields, ExportPassToggles } from './ExportControls'
import { ClockIcon, CursorIcon, DrawPathIcon, PenIcon, PlayIcon, TargetIcon } from './icons'
import { useChromeLayout } from './viewportInsets'
import { undo, redo } from '../lib/history'

function ToolButton({
  children,
  active = false,
  disabled = false,
  title,
  onClick,
  dataTour,
  wide = false,
}: {
  children: ReactNode
  active?: boolean
  disabled?: boolean
  title: string
  onClick?: () => void
  /** Stable hook for the guided tutorial's spotlight (issue #78). */
  dataTour?: string
  wide?: boolean
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      data-tour={dataTour}
      className={`flex shrink-0 items-center justify-center rounded-md transition-colors ${wide ? 'h-11 w-auto min-w-11 gap-1 px-2' : 'h-7 w-7'} ${
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

const PHONE_VIEWS: { value: QuickView; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'top', label: 'Top' },
  { value: 'right', label: 'Right' },
]

function PhoneQuickViews() {
  const requestView = useEditorStore((s) => s.requestView)
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-lg bg-panel-2 px-2 py-1.5" aria-label="Editor views">
      <span className="text-[10px] text-ink-dim">View</span>
      <div className="flex rounded-full bg-panel p-0.5">
        {PHONE_VIEWS.map((view) => (
          <button
            key={view.value}
            type="button"
            onClick={() => requestView(view.value)}
            className="min-h-8 rounded-full px-2.5 text-[11px] text-ink-dim hover:bg-panel-3 hover:text-ink"
          >
            {view.label}
          </button>
        ))}
      </div>
    </div>
  )
}

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

function ExportMenu({ disabled }: { disabled: boolean }) {
  // Open-state lives in the store so the guided tutorial can open it and detect
  // that the export step was reached (issue #78).
  const open = useEditorStore((s) => s.exportMenuOpen)
  const setOpen = useEditorStore((s) => s.setExportMenuOpen)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open, setOpen])

  return (
    <div ref={ref} className="relative">
      <button
        data-tour="export"
        title={disabled ? 'Create a path first' : 'Export video or camera rig'}
        disabled={disabled}
        onClick={() => setOpen(!open)}
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
          <ExportFormatFields />
          <ExportPassToggles />
          <ExportActions onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}

export function Toolbar({ phoneSheet = false }: { phoneSheet?: boolean } = {}) {
  const tool = useEditorStore((s) => s.tool)
  const setTool = useEditorStore((s) => s.setTool)
  const gizmoMode = useEditorStore((s) => s.gizmoMode)
  const selection = useEditorStore((s) => s.selection)
  const zoomPct = useEditorStore((s) => s.zoomPct)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const hasPath = useCameraReady()
  const { tier } = useChromeLayout()
  const compact = tier !== 'full'
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

  const gizmoRow = (
    <div data-tour="object-transform" className="flex items-center gap-px px-0.5">
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
  )

  const framingRow =
    workspaceMode !== 'visualize' ? (
      <>
        <ToolButton
          title="Center the view on the world origin (H)"
          onClick={() => useEditorStore.getState().requestHome()}
          wide={phoneSheet}
        >
          <TargetIcon />
          {phoneSheet && <span className="text-[10px]">Home</span>}
        </ToolButton>
        <button
          aria-label="Frame selected objects"
          title={`Frame selected objects (F) · Zoom ${zoomPct}%`}
          onClick={() => useEditorStore.getState().requestFrame()}
          className={`${phoneSheet ? 'h-11 min-w-16 rounded-md bg-panel-2 px-2' : 'w-11'} text-center text-[11px] tabular-nums text-ink-dim hover:text-ink`}
        >
          {phoneSheet ? 'Frame' : `${zoomPct}%`}
        </button>
        <ToolButton
          title="Timeline (T)"
          active={workspaceMode === 'compose'}
          onClick={() => phoneSheet
            ? useEditorStore.getState().setActiveTaskPanel('timeline')
            : openComposeTimeline()}
        >
          <ClockIcon />
        </ToolButton>
      </>
    ) : null

  return (
    <div className={`panel relative z-20 flex w-max shrink-0 items-center justify-center gap-0.5 px-1.5 py-1 ${phoneSheet ? 'flex-wrap' : ''}`}>
      {phoneSheet && composeTools && <PhoneQuickViews />}
      {sceneTools && (
        <>
          {composeTools && !compact && (
            <AddObjectMenu includePath title="Add a shape, path, or import a model" />
          )}
          {composeTools && !compact && <Divider />}
          <ToolButton title="Select (V)" active={tool === 'select'} onClick={() => setTool('select')}>
            <CursorIcon />
          </ToolButton>
          {composeTools && (
            <>
              {(tool === 'pen' || !compact || phoneSheet) && (
                <ToolButton
                  title="Pen — click to place path points (P)"
                  active={tool === 'pen'}
                  onClick={() => setTool('pen')}
                  dataTour="pen-tool"
                >
                  <PenIcon />
                </ToolButton>
              )}
              {(tool === 'draw' || !compact) && (
                <ToolButton
                  title="Draw — stroke a new camera path from the top view (D)"
                  active={tool === 'draw'}
                  onClick={() => setTool('draw')}
                >
                  <DrawPathIcon />
                </ToolButton>
              )}
            </>
          )}
          {(!compact || phoneSheet) && (
            <>
              <Divider />
              {gizmoRow}
              {tool === 'pen' && composeTools && (
                <>
                  <Divider />
                  <SnapControls />
                </>
              )}
              <Divider />
            </>
          )}
        </>
      )}
      {(!compact || phoneSheet) && framingRow}
      <ToolButton title="Undo (Ctrl+Z)" onClick={() => undo()}>
        <span className="text-[11px]">↶</span>
      </ToolButton>
      <ToolButton title="Redo (Ctrl+Shift+Z)" onClick={() => redo()}>
        <span className="text-[11px]">↷</span>
      </ToolButton>
      {compact && (
        <ToolbarMore>
          {composeTools && <AddObjectMenu includePath title="Add a shape, path, or import a model" />}
          {composeTools && tool !== 'pen' && (
            <ToolButton
              title="Pen — click to place path points (P)"
              active={false}
              onClick={() => setTool('pen')}
            >
              <PenIcon />
            </ToolButton>
          )}
          {composeTools && tool !== 'draw' && (
            <ToolButton
              title="Draw — stroke a new camera path from the top view (D)"
              active={false}
              onClick={() => setTool('draw')}
            >
              <DrawPathIcon />
            </ToolButton>
          )}
          {!phoneSheet && gizmoRow}
          {tool === 'pen' && composeTools && <SnapControls />}
          {!phoneSheet && framingRow}
        </ToolbarMore>
      )}
      <ExportMenu disabled={!hasPath} />
      {workspaceMode !== 'visualize' && (
        <ToolButton
          title={hasPath ? 'Fullscreen preview (hides panels)' : 'Create a path first'}
          disabled={!hasPath}
          onClick={enterPlay}
        >
          <PlayIcon />
        </ToolButton>
      )}
    </div>
  )
}

function ToolbarMore({ children }: { children: ReactNode }) {
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
      <ToolButton title="More" active={open} onClick={() => setOpen((value) => !value)}>
        <span className="text-[11px]">⋯</span>
      </ToolButton>
      {open && (
        <div className="panel absolute right-0 top-9 z-30 flex items-center gap-0.5 p-1">
          {children}
        </div>
      )}
    </div>
  )
}
