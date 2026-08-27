import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { applyShot } from '../../lib/projects'
import { applyTogglePlayback } from '../../lib/playback'
import { exportDimensions } from '../../lib/recorder'
import { formatTimecode, frameToTime, snapToFrame, timeToFrame } from '../../lib/timeView'
import { useCameraReady } from '../../state/cameraPathLink'
import { useCameraOptionsStore } from '../../state/useCameraOptionsStore'
import { useEditorStore, type ViewMode } from '../../state/useEditorStore'
import { useProjectStore, type Shot } from '../../state/useProjectStore'
import { useRigStore } from '../../state/useRigStore'
import { ExportActions, ExportFormatPills, ExportPassesMenu } from '../ExportControls'
import { CameraIcon, EyeIcon, EyeOffIcon, PlayIcon } from '../icons'
import { Segmented } from '../primitives'
import {
  chromeBand,
  GUTTER,
  VISUALIZE_DOCK_HEIGHT,
  useViewportInsets,
  useWindowSize,
} from '../viewportInsets'

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: 'look', label: 'Look' },
  { value: 'clay', label: 'Clay' },
  { value: 'depth', label: 'Depth' },
  { value: 'outline', label: 'Outline' },
  { value: 'normals', label: 'Normals' },
]

const PauseIcon = () => (
  <svg width={12} height={12} viewBox="0 0 16 16" fill="currentColor">
    <rect x="3.5" y="3" width="3.2" height="10" rx="1" />
    <rect x="9.3" y="3" width="3.2" height="10" rx="1" />
  </svg>
)

function writeDepthNear(value: number) {
  const editor = useEditorStore.getState()
  if (editor.viewMode !== 'depth') editor.setViewMode('depth')
  editor.setDepthNear(value)
}

function writeDepthFar(value: number) {
  const editor = useEditorStore.getState()
  if (editor.viewMode !== 'depth') editor.setViewMode('depth')
  editor.setDepthFar(value)
}

function BarGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-ink-dim">
        {label}
      </span>
      {children}
    </div>
  )
}

function BarRule() {
  return <span className="h-5 w-px shrink-0 bg-line" aria-hidden />
}

function VisualizeScrubber() {
  const t = useRigStore((s) => s.t)
  const duration = useRigStore((s) => s.duration)
  const fps = useRigStore((s) => s.fps)
  const trackRef = useRef<HTMLDivElement>(null)

  const seekFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (clientX - rect.left) / Math.max(1e-6, rect.width)
    const next = snapToFrame(Math.min(1, Math.max(0, x)), duration, fps)
    const rig = useRigStore.getState()
    if (rig.playing) rig.setPlaying(false)
    rig.setT(next)
  }

  const stepFrame = (delta: number) => {
    const rig = useRigStore.getState()
    if (rig.playing) rig.setPlaying(false)
    const frame = timeToFrame(rig.t, rig.duration, rig.fps)
    rig.setT(frameToTime(frame + delta, rig.duration, rig.fps))
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    seekFromClientX(e.clientX)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    seekFromClientX(e.clientX)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      stepFrame(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      stepFrame(1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      const rig = useRigStore.getState()
      if (rig.playing) rig.setPlaying(false)
      rig.setT(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      const rig = useRigStore.getState()
      if (rig.playing) rig.setPlaying(false)
      rig.setT(1)
    }
  }

  return (
    <div
      ref={trackRef}
      data-visualize-scrubber
      role="slider"
      tabIndex={0}
      aria-label="Shot time"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={t}
      title="Hover or drag to pick a frame"
      className="relative h-[22px] w-full shrink-0 cursor-ew-resize select-none outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-panel-3" />
      <div
        className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent/35"
        style={{ width: `${t * 100}%` }}
      />
      <div
        className="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
        style={{ left: `${t * 100}%` }}
      />
    </div>
  )
}

function VisualizeLetterbox() {
  const exportAspect = useEditorStore((s) => s.exportAspect)
  const exportRes = useEditorStore((s) => s.exportRes)
  const customSize = useEditorStore((s) => s.customSize)
  const insets = useViewportInsets()
  const win = useWindowSize()
  const band = chromeBand(insets, win.w)
  const [tw, th] = exportDimensions(exportAspect, exportRes, customSize)
  const target = tw / th
  const boxW = Math.max(1, band.width)
  const boxH = Math.max(1, win.h - insets.top - insets.bottom)
  const box = boxW / boxH
  const frame =
    target < box
      ? { height: '100%', width: `${(target / box) * 100}%` }
      : { width: '100%', height: `${(box / target) * 100}%` }

  return (
    <div
      className="pointer-events-none absolute z-10 overflow-hidden"
      style={{
        left: band.left,
        width: band.width,
        top: insets.top,
        height: boxH,
      }}
    >
      <div className="flex h-full w-full items-center justify-center">
        <div
          className="border border-white/40"
          style={{ ...frame, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)' }}
        />
      </div>
    </div>
  )
}

function VisualizeShotThumb({ shot, index }: { shot: Shot; index: number }) {
  const active = useEditorStore((s) => s.activeShotId === shot.id)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!shot.thumbnail) return
    const next = URL.createObjectURL(shot.thumbnail)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [shot.thumbnail])

  return (
    <button
      type="button"
      title={`Review ${shot.name}`}
      onClick={() => applyShot(shot)}
      className={`relative h-11 w-[4.75rem] shrink-0 overflow-hidden rounded-md text-left ${
        active ? 'ring-1 ring-accent' : 'bg-panel-2 hover:bg-panel-3'
      }`}
    >
      <div className="h-full bg-black/30">
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-dim">
            <CameraIcon size={14} />
          </div>
        )}
        <span className="absolute left-1 top-1 rounded bg-black/50 px-1 text-[9px] text-white">
          Shot {index + 1}
        </span>
      </div>
    </button>
  )
}

function DepthRangeControls() {
  const depthNear = useEditorStore((s) => s.depthNear)
  const depthFar = useEditorStore((s) => s.depthFar)
  const depthRangeAuto = useEditorStore((s) => s.depthRangeAuto)
  const viewMode = useEditorStore((s) => s.viewMode)
  const live = viewMode === 'depth'

  return (
    <div data-depth-range className="flex min-w-[16rem] flex-1 items-center gap-2">
      <button
        type="button"
        title="Fit near/far to the scene every frame"
        onClick={() => {
          const editor = useEditorStore.getState()
          if (editor.viewMode !== 'depth') editor.setViewMode('depth')
          editor.setDepthRangeAuto(!editor.depthRangeAuto)
        }}
        className={`shrink-0 rounded-md px-2 py-1 text-[11px] ${
          depthRangeAuto && live ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
        }`}
      >
        Auto
      </button>
      <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-ink-dim">
        Near
        <input
          type="range"
          min={0.05}
          max={40}
          step={0.05}
          value={depthNear}
          aria-label="Depth near"
          onPointerDown={() => {
            if (useEditorStore.getState().viewMode !== 'depth') {
              useEditorStore.getState().setViewMode('depth')
            }
          }}
          onChange={(e) => writeDepthNear(Number(e.target.value))}
          className="h-4 min-w-[3.5rem] flex-1 cursor-pointer accent-accent"
        />
        <span className="w-7 shrink-0 tabular-nums text-[10px] text-ink">{depthNear.toFixed(1)}</span>
      </label>
      <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-ink-dim">
        Far
        <input
          type="range"
          min={0.1}
          max={80}
          step={0.1}
          value={depthFar}
          aria-label="Depth far"
          onPointerDown={() => {
            if (useEditorStore.getState().viewMode !== 'depth') {
              useEditorStore.getState().setViewMode('depth')
            }
          }}
          onChange={(e) => writeDepthFar(Number(e.target.value))}
          className="h-4 min-w-[3.5rem] flex-1 cursor-pointer accent-accent"
        />
        <span className="w-7 shrink-0 tabular-nums text-[10px] text-ink">{depthFar.toFixed(1)}</span>
      </label>
    </div>
  )
}

export function VisualizeBar() {
  const [picker, setPicker] = useState<'shots' | 'cameras'>('shots')
  const shots = useProjectStore((s) => s.shots)
  const ordered = [...shots].sort((a, b) => a.order - b.order)
  const cameras = useCameraOptionsStore((s) => s.options)
  const activeCameraId = useCameraOptionsStore((s) => s.activeOptionId)
  const playing = useRigStore((s) => s.playing)
  const loop = useRigStore((s) => s.loop)
  const t = useRigStore((s) => s.t)
  const duration = useRigStore((s) => s.duration)
  const viewMode = useEditorStore((s) => s.viewMode)
  const showSceneObjects = useEditorStore((s) => s.showSceneObjects)
  const toggleShowSceneObjects = useEditorStore((s) => s.toggleShowSceneObjects)
  const hasPath = useCameraReady()
  const insets = useViewportInsets()
  const win = useWindowSize()
  const band = chromeBand(insets, win.w)

  return (
    <>
      <VisualizeLetterbox />
      <div
        data-visualize-bar
        className="panel absolute z-20 flex flex-col gap-1 overflow-hidden px-3 py-2"
        style={{
          left: band.left,
          width: band.width,
          bottom: GUTTER,
          height: VISUALIZE_DOCK_HEIGHT,
        }}
      >
        <div className="flex h-11 min-w-0 items-center gap-2">
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              title={hasPath ? 'Play / Pause (Space)' : 'Create a camera first'}
              disabled={!hasPath}
              onClick={() => applyTogglePlayback()}
              className={`flex h-8 w-8 items-center justify-center rounded-full ${
                playing ? 'bg-accent text-white' : 'bg-panel-2 text-ink hover:bg-panel-3'
              } disabled:cursor-not-allowed disabled:text-ink-dim/50`}
            >
              {playing ? <PauseIcon /> : <PlayIcon size={12} />}
            </button>
            <button
              type="button"
              title="Loop this take"
              onClick={() => useRigStore.getState().setLoop(!loop)}
              className={`rounded-md px-2 py-1 text-[11px] ${
                loop ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
              }`}
            >
              Loop
            </button>
            <span className="min-w-[4.5rem] text-[11px] tabular-nums text-ink-dim">
              {formatTimecode(t, duration)} / {formatTimecode(1, duration)}
            </span>
          </div>
          <BarRule />
          <Segmented
            className="w-[9.25rem] shrink-0"
            options={[
              { value: 'shots', label: 'Shots' },
              { value: 'cameras', label: 'Cameras' },
            ]}
            value={picker}
            onChange={setPicker}
          />
          <div className="flex h-11 min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {picker === 'shots' ? (
              ordered.length === 0 ? (
                <p className="self-center text-[11px] text-ink-dim">
                  No shots yet. Save a take in Compose.
                </p>
              ) : (
                ordered.map((shot, index) => (
                  <VisualizeShotThumb key={shot.id} shot={shot} index={index} />
                ))
              )
            ) : (
              cameras.map((camera) => (
                <button
                  key={camera.id}
                  type="button"
                  title={`Look through ${camera.name}`}
                  onClick={() => useCameraOptionsStore.getState().switchOption(camera.id)}
                  className={`h-8 shrink-0 rounded-md px-2.5 text-[11px] ${
                    camera.id === activeCameraId
                      ? 'bg-accent text-white'
                      : 'bg-panel-2 text-ink hover:bg-panel-3'
                  }`}
                >
                  {camera.name}
                </button>
              ))
            )}
          </div>
          <BarRule />
          <ExportActions compact includeRig={false} />
        </div>

        <VisualizeScrubber />

        <div className="flex min-h-9 min-w-0 flex-1 items-center gap-3 overflow-x-auto">
          <BarGroup label="Look">
            <div className="flex rounded-md bg-panel-2 p-0.5">
              {VIEW_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  title={`Review as ${mode.label.toLowerCase()}`}
                  onClick={() => useEditorStore.getState().setViewMode(mode.value)}
                  className={`rounded-[5px] px-2.5 py-1 text-[11px] ${
                    viewMode === mode.value ? 'bg-accent text-white' : 'text-ink-dim hover:text-ink'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            {viewMode === 'outline' && (
              <button
                type="button"
                title={showSceneObjects ? 'Hide scene objects' : 'Show scene objects'}
                aria-pressed={showSceneObjects}
                onClick={() => toggleShowSceneObjects()}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                  showSceneObjects
                    ? 'text-ink-dim hover:bg-panel-3 hover:text-ink'
                    : 'bg-accent text-white'
                }`}
              >
                {showSceneObjects ? <EyeIcon size={13} /> : <EyeOffIcon size={13} />}
              </button>
            )}
          </BarGroup>
          <BarRule />
          <BarGroup label="Range">
            <DepthRangeControls />
          </BarGroup>
          <BarRule />
          <BarGroup label="Format">
            <ExportFormatPills />
          </BarGroup>
          <BarRule />
          <ExportPassesMenu />
        </div>
      </div>
    </>
  )
}
