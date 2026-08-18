import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  StageHost,
  WarmPathTimeoutError,
  type StageBootMode,
  type StageEditTool,
  type StageViewMode,
} from './StageHost'
import { createDemoExportManifest, type QualityMode } from './exportManifest'
import {
  exportGsClientVideo,
  warmPathTimeoutUserMessage,
  type GsExportProgress,
  GsExportCancelledError,
  GsExportUnsupportedError,
} from './gsClientExport'
import {
  DEFAULT_SHOT_DURATION_S,
  MAX_SHOT_DURATION_S,
  MIN_SHOT_DURATION_S,
  clampShotDuration,
} from './pathOverlayMath'
import { isWebGpuAvailable, requestWebGpuAdapter } from './webGpu'

type Phase =
  | { status: 'checking' }
  | { status: 'blocked'; reason: string }
  | { status: 'choose' }
  | { status: 'running'; mode: StageBootMode; loading: boolean; error?: string }

type WarmStatus =
  | { state: 'idle' }
  | { state: 'warming' }
  | { state: 'ready' }
  | { state: 'timeout'; message: string }
  | { state: 'error'; message: string }

type ExportUi =
  | { state: 'idle' }
  | { state: 'running'; progress: GsExportProgress }
  | { state: 'done' }
  | { state: 'cancelled' }
  | { state: 'error'; message: string }

function StageBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-full min-h-screen flex-col overflow-hidden bg-[#0f0f11] text-ink">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 55% at 50% -10%, color-mix(in srgb, var(--color-accent) 18%, transparent), transparent 55%), radial-gradient(ellipse 50% 40% at 85% 90%, color-mix(in srgb, var(--color-accent) 8%, transparent), transparent 50%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div className="relative z-10 flex min-h-screen flex-1 flex-col">{children}</div>
    </div>
  )
}

function BrandMark({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-sm font-semibold tracking-tight text-white shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_40%,transparent)]">
        R
      </div>
      <div className="min-w-0 text-left">
        <p className="text-[15px] font-medium tracking-tight text-white">Rig</p>
        {subtitle ? <p className="text-[11px] text-ink-dim">{subtitle}</p> : null}
      </div>
    </div>
  )
}

function FloatingPanel({
  className = '',
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`panel bg-panel/92 backdrop-blur-md ${className}`}>{children}</div>
  )
}

function SegmentedPill<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex rounded-full bg-panel-2/90 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`rounded-full px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
            value === option.value
              ? 'bg-accent text-white'
              : 'text-ink-dim hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function IconSelect({ active }: { active?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 2.5L12.5 7.2L8.2 8.5L6.5 13L3.5 2.5Z"
        stroke={active ? 'currentColor' : 'currentColor'}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconPen({ active }: { active?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M10.2 2.8L13.2 5.8L5.8 13.2H2.8V10.2L10.2 2.8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        opacity={active ? 1 : 0.9}
      />
      <path d="M8.8 4.2L11.8 7.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function IconPlay() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <path d="M4 2.8v8.4l7.2-4.2L4 2.8Z" />
    </svg>
  )
}

function IconPause() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <rect x="3.2" y="2.8" width="2.4" height="8.4" rx="0.6" />
      <rect x="8.4" y="2.8" width="2.4" height="8.4" rx="0.6" />
    </svg>
  )
}

function WebGpuGateScreen({ reason }: { reason: string }) {
  return (
    <StageBackdrop>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <FloatingPanel className="w-full max-w-md px-7 py-8 text-center shadow-panel">
          <div className="flex justify-center">
            <BrandMark subtitle="Gaussian stage · WebGPU" />
          </div>
          <h1 className="mt-7 text-2xl font-medium tracking-tight text-white">
            WebGPU is required
          </h1>
          <p className="mt-3 text-sm leading-6 text-ink-dim">{reason}</p>
          <p className="mt-2 text-sm leading-6 text-ink-dim">
            Use a current Chrome or Edge build with WebGPU enabled, then reload this page.
          </p>
          <div className="mt-7 flex flex-col items-stretch gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <a
              className="rounded-lg border border-line bg-panel-2 px-5 py-2.5 text-sm text-ink hover:bg-panel-3"
              href="?runtime=clay"
            >
              Open clay editor
            </a>
          </div>
        </FloatingPanel>
      </div>
    </StageBackdrop>
  )
}

const BOOT_OPTIONS: {
  mode: StageBootMode
  title: string
  description: string
  badge: string
}[] = [
  {
    mode: 'demo',
    title: 'Demo stage',
    description: 'Streamed SOG Location with a clay Object — ready to draw a camera path.',
    badge: 'Recommended',
  },
  {
    mode: 'blank',
    title: 'Blank stage',
    description: 'Empty stage with a drawing plane. Start from scratch with no demo assets.',
    badge: 'Empty',
  },
]

function BootChooser({ onChoose }: { onChoose: (mode: StageBootMode) => void }) {
  const [selected, setSelected] = useState<StageBootMode>('demo')
  const detail = BOOT_OPTIONS.find((o) => o.mode === selected) ?? BOOT_OPTIONS[0]

  return (
    <StageBackdrop>
      <header className="flex items-center justify-between px-6 py-5">
        <BrandMark subtitle="GS spike · Open a stage" />
        <a
          className="text-[11px] text-ink-dim transition-colors hover:text-ink"
          href="?runtime=clay"
        >
          Clay editor (archive)
        </a>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16">
        <div className="mb-8 max-w-lg text-center">
          <h1 className="text-3xl font-medium tracking-tight text-white">Open a stage</h1>
          <p className="mt-2 text-sm leading-6 text-ink-dim">
            Choose a starting point. You can always come back — this spike keeps Demo and Blank as
            intentional first moments.
          </p>
        </div>

        <FloatingPanel className="w-full max-w-2xl overflow-hidden shadow-panel">
          <div className="grid gap-0 md:grid-cols-[1.2fr_0.9fr]">
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {BOOT_OPTIONS.map((option) => {
                const active = selected === option.mode
                return (
                  <button
                    key={option.mode}
                    type="button"
                    onClick={() => setSelected(option.mode)}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? 'border-accent bg-panel-2'
                        : 'border-line bg-panel-2/40 hover:border-line hover:bg-panel-2/80'
                    }`}
                  >
                    <div
                      className={`mb-3 flex h-24 items-center justify-center rounded-lg ${
                        option.mode === 'demo'
                          ? 'bg-[linear-gradient(145deg,#1e293b_0%,#0f172a_55%,color-mix(in_srgb,var(--color-accent)_35%,#0f172a)_100%)]'
                          : 'bg-panel-3'
                      }`}
                    >
                      {option.mode === 'demo' ? (
                        <span className="text-[11px] font-medium tracking-[0.18em] text-white/70">
                          DEMO
                        </span>
                      ) : (
                        <span className="text-2xl font-light text-ink-dim">+</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white">{option.title}</p>
                      <span className="rounded-full bg-panel-3 px-2 py-0.5 text-[10px] text-ink-dim">
                        {option.badge}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-4 text-ink-dim">
                      {option.description}
                    </p>
                  </button>
                )
              })}
            </div>

            <div className="flex flex-col border-t border-line bg-panel-2/50 p-5 md:border-l md:border-t-0">
              <p className="text-[11px] uppercase tracking-[0.16em] text-ink-dim">Selected</p>
              <h2 className="mt-2 text-lg font-medium text-white">{detail.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-ink-dim">{detail.description}</p>
              <button
                type="button"
                className="mt-6 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
                onClick={() => onChoose(selected)}
              >
                Open {detail.mode === 'demo' ? 'demo' : 'blank'}
              </button>
            </div>
          </div>
        </FloatingPanel>
      </div>
    </StageBackdrop>
  )
}

function exportPhaseLabel(progress: GsExportProgress): string {
  switch (progress.phase) {
    case 'warming':
      return 'Warming path…'
    case 'encoding':
      return 'Encoding video…'
    case 'finalizing':
      return 'Finalizing…'
    case 'pinning':
      return 'Preparing…'
    default: {
      const _exhaustive: never = progress.phase
      return _exhaustive
    }
  }
}

function ExportOverlay({
  progress,
  onCancel,
}: {
  progress: GsExportProgress
  onCancel: () => void
}) {
  const pct = Math.round(progress.fraction * 100)
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 px-4 backdrop-blur-[2px]">
      <FloatingPanel className="w-full max-w-sm px-6 py-6 shadow-panel">
        <p className="text-[11px] uppercase tracking-[0.16em] text-ink-dim">Export MP4</p>
        <h2 className="mt-2 text-lg font-medium text-white">{exportPhaseLabel(progress)}</h2>
        <div className="mt-5">
          <div className="mb-1.5 flex justify-between text-[11px] text-ink-dim">
            <span>{pct}%</span>
            {progress.totalFrames != null && progress.frameIndex != null ? (
              <span className="tabular-nums">
                {progress.frameIndex}/{progress.totalFrames} frames
              </span>
            ) : (
              <span>Client encode</span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-panel-3">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-6 w-full rounded-lg border border-line bg-panel-2 px-4 py-2 text-sm text-ink hover:bg-panel-3"
        >
          Cancel export
        </button>
      </FloatingPanel>
    </div>
  )
}

export function GsRuntimeApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<StageHost | null>(null)
  const warmGenerationRef = useRef(0)
  const [phase, setPhase] = useState<Phase>({ status: 'checking' })
  const [viewMode, setViewMode] = useState<StageViewMode>('orbit')
  const [editTool, setEditTool] = useState<StageEditTool>('select')
  const [showBlocking, setShowBlocking] = useState(false)
  const [qualityMode, setQualityMode] = useState<QualityMode>('preview')
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [durationS, setDurationS] = useState(DEFAULT_SHOT_DURATION_S)
  const [anchorCount, setAnchorCount] = useState(0)
  const [warmStatus, setWarmStatus] = useState<WarmStatus>({ state: 'idle' })
  const [exportUi, setExportUi] = useState<ExportUi>({ state: 'idle' })
  const exportAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!isWebGpuAvailable()) {
        if (!cancelled) {
          setPhase({
            status: 'blocked',
            reason: 'This browser does not expose navigator.gpu.',
          })
        }
        return
      }
      const adapter = await requestWebGpuAdapter()
      if (cancelled) return
      if (!adapter) {
        setPhase({
          status: 'blocked',
          reason: 'No WebGPU adapter is available (GPU blocked or unsupported).',
        })
        return
      }
      setPhase({ status: 'choose' })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (phase.status !== 'running') return
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    const mode = phase.mode
    warmGenerationRef.current += 1
    setQualityMode('preview')
    setTime(0)
    setPlaying(false)
    setDurationS(DEFAULT_SHOT_DURATION_S)
    setEditTool('select')
    setAnchorCount(0)
    setWarmStatus({ state: 'idle' })
    setExportUi({ state: 'idle' })
    exportAbortRef.current?.abort()
    exportAbortRef.current = null

    void StageHost.create({
      canvas,
      mode,
      onReady: () => {
        if (!cancelled) setPhase({ status: 'running', mode, loading: false })
      },
      onError: (error) => {
        if (!cancelled) setPhase({ status: 'running', mode, loading: false, error: error.message })
      },
    })
      .then((host) => {
        if (cancelled) {
          host.dispose()
          return
        }
        hostRef.current = host
        host.setViewMode('orbit')
        host.setEditTool('select')
        host.setObjectBlockingVisible(false)
        host.setQualityPin(null)
        host.setTime(0)
        host.setOnPathChange((path) => {
          if (!cancelled) setAnchorCount(path.anchors.length)
        })
        setAnchorCount(host.getAnchorCount())
      })
      .catch(() => {
        /* onError already updated phase */
      })

    return () => {
      cancelled = true
      hostRef.current?.setOnPathChange(null)
      hostRef.current?.dispose()
      hostRef.current = null
    }
  }, [phase.status === 'running' ? phase.mode : null])

  useEffect(() => {
    const onResize = () => hostRef.current?.resize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    hostRef.current?.setViewMode(viewMode)
  }, [viewMode])

  useEffect(() => {
    hostRef.current?.setEditTool(editTool)
  }, [editTool])

  useEffect(() => {
    hostRef.current?.setObjectBlockingVisible(showBlocking)
  }, [showBlocking])

  useEffect(() => {
    hostRef.current?.setTime(time)
  }, [time])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setTime((prev) => {
        const next = prev + dt / durationS
        if (next >= 1) {
          setPlaying(false)
          return 1
        }
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, durationS])

  const applyQualityMode = async (next: QualityMode) => {
    const host = hostRef.current
    if (!host) return
    const generation = ++warmGenerationRef.current
    setQualityMode(next)

    if (next === 'preview') {
      host.setQualityPin(null)
      setWarmStatus({ state: 'idle' })
      return
    }

    const manifest = createDemoExportManifest({ durationS })
    host.setQualityPin(manifest)
    setWarmStatus({ state: 'warming' })
    try {
      await host.warmPath(manifest.pathSamples, manifest.warmTimeoutMs)
      if (warmGenerationRef.current !== generation) return
      setWarmStatus({ state: 'ready' })
    } catch (error) {
      if (warmGenerationRef.current !== generation) return
      if (error instanceof WarmPathTimeoutError) {
        setWarmStatus({ state: 'timeout', message: error.message })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      setWarmStatus({ state: 'error', message })
    }
  }

  const clearPath = () => {
    const host = hostRef.current
    if (!host) return
    host.clearPathAnchors()
    setPlaying(false)
    setTime(0)
  }

  const cancelExport = () => {
    exportAbortRef.current?.abort()
  }

  const startExport = async () => {
    const host = hostRef.current
    if (!host || exportUi.state === 'running' || anchorCount < 2) return

    setPlaying(false)
    setViewMode('camera')
    setEditTool('select')
    // Export always locks quality for the job (Preview/Locked UI restored via pin restore).
    setQualityMode('locked')
    setWarmStatus({ state: 'warming' })

    const abort = new AbortController()
    exportAbortRef.current = abort
    setExportUi({
      state: 'running',
      progress: { phase: 'pinning', fraction: 0 },
    })

    const manifest = createDemoExportManifest({ durationS })
    try {
      await exportGsClientVideo({
        host,
        manifest,
        durationS,
        signal: abort.signal,
        onProgress: (progress) => {
          setExportUi({ state: 'running', progress })
          if (progress.phase === 'warming') {
            setWarmStatus({ state: 'warming' })
          } else if (progress.phase === 'encoding' || progress.phase === 'finalizing') {
            setWarmStatus({ state: 'ready' })
          }
        },
      })
      if (abort.signal.aborted) {
        setExportUi({ state: 'cancelled' })
        return
      }
      setExportUi({ state: 'done' })
      setWarmStatus({ state: 'ready' })
    } catch (error) {
      if (error instanceof GsExportCancelledError || abort.signal.aborted) {
        setExportUi({ state: 'cancelled' })
      } else if (error instanceof WarmPathTimeoutError) {
        const message = warmPathTimeoutUserMessage(error.timeoutMs)
        setWarmStatus({ state: 'timeout', message })
        setExportUi({ state: 'error', message })
      } else if (error instanceof GsExportUnsupportedError) {
        setExportUi({ state: 'error', message: error.message })
      } else {
        const message = error instanceof Error ? error.message : String(error)
        setExportUi({ state: 'error', message })
      }
    } finally {
      exportAbortRef.current = null
      // Restore Preview|Locked chrome from the pin the host put back (export always
      // temporarily locks). Do not clear timeout / error warm notices.
      const pinned = host.getQualityManifest()
      if (pinned) {
        setQualityMode('locked')
      } else {
        setQualityMode('preview')
        setWarmStatus((prev) =>
          prev.state === 'timeout' || prev.state === 'error' ? prev : { state: 'idle' },
        )
      }
    }
  }

  if (phase.status === 'checking') {
    return (
      <StageBackdrop>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
          <BrandMark subtitle="Checking WebGPU…" />
          <div className="h-1 w-40 overflow-hidden rounded-full bg-panel-3">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
          </div>
        </div>
      </StageBackdrop>
    )
  }

  if (phase.status === 'blocked') {
    return <WebGpuGateScreen reason={phase.reason} />
  }

  if (phase.status === 'choose') {
    return (
      <BootChooser
        onChoose={(mode) => setPhase({ status: 'running', mode, loading: true })}
      />
    )
  }

  if (phase.error) {
    return (
      <StageBackdrop>
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <FloatingPanel className="w-full max-w-md px-7 py-8 text-center shadow-panel">
            <BrandMark subtitle="Stage failed" />
            <h1 className="mt-6 text-xl font-medium text-white">Could not start the stage</h1>
            <p className="mt-3 text-sm leading-6 text-ink-dim">{phase.error}</p>
            <button
              type="button"
              className="mt-7 rounded-lg border border-line bg-panel-2 px-5 py-2.5 text-sm text-ink hover:bg-panel-3"
              onClick={() => setPhase({ status: 'choose' })}
            >
              Back to stage chooser
            </button>
          </FloatingPanel>
        </div>
      </StageBackdrop>
    )
  }

  const warmLabel = (() => {
    switch (warmStatus.state) {
      case 'idle':
        return qualityMode === 'preview' ? 'Preview quality' : 'Locked quality'
      case 'warming':
        return 'Warming path…'
      case 'ready':
        return 'Locked · path warm'
      case 'timeout':
        return 'Warm timeout (cloud later)'
      case 'error':
        return warmStatus.message
      default: {
        const _exhaustive: never = warmStatus
        return _exhaustive
      }
    }
  })()

  const clockLabel = `${(time * durationS).toFixed(1)}s / ${durationS.toFixed(1)}s`
  const pathReady = anchorCount >= 2
  const exporting = exportUi.state === 'running'
  const busyWarm = warmStatus.state === 'warming' || exporting

  return (
    <div className="relative h-full min-h-screen bg-[#0f0f11]">
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full touch-none ${
          editTool === 'pen' && viewMode === 'orbit' ? 'cursor-crosshair' : ''
        }`}
      />

      {phase.loading && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
          <FloatingPanel className="px-5 py-3 text-sm text-ink">
            Loading {phase.mode} stage…
          </FloatingPanel>
        </div>
      )}

      {!phase.loading && (
        <>
          {/* Top floating chrome — brand, view, quality, export */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3">
            <div className="pointer-events-auto flex flex-col gap-2">
              <FloatingPanel className="flex items-center gap-3 px-2.5 py-1.5">
                <BrandMark subtitle={`GS spike · ${phase.mode}`} />
                <div className="mx-1 h-6 w-px bg-line" />
                <SegmentedPill
                  options={[
                    { value: 'orbit', label: 'Orbit' },
                    { value: 'camera', label: 'Camera' },
                  ]}
                  value={viewMode}
                  onChange={(next) => {
                    setViewMode(next)
                    if (next === 'camera') setEditTool('select')
                  }}
                />
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-[11px] text-ink-dim hover:bg-panel-2 hover:text-ink"
                  onClick={() => setPhase({ status: 'choose' })}
                >
                  Change
                </button>
              </FloatingPanel>

              {viewMode === 'orbit' && editTool === 'pen' && (
                <p className="max-w-xs rounded-lg border border-line bg-panel/90 px-2.5 py-1.5 text-[11px] leading-4 text-ink-dim backdrop-blur-md">
                  Click the ground to add path points. Switch to Select to drag a point.
                </p>
              )}
            </div>

            <div className="pointer-events-auto flex flex-col items-end gap-2">
              <FloatingPanel className="flex flex-wrap items-center justify-end gap-2 px-2 py-1.5">
                <SegmentedPill
                  options={[
                    { value: 'preview', label: 'Preview' },
                    { value: 'locked', label: 'Locked' },
                  ]}
                  value={qualityMode}
                  disabled={busyWarm}
                  onChange={(next) => void applyQualityMode(next)}
                />
                <button
                  type="button"
                  disabled={!pathReady || phase.loading || exporting}
                  onClick={() => void startExport()}
                  className="rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                >
                  Export MP4
                </button>
                <a
                  className="rounded-full px-2 py-1 text-[11px] text-ink-dim hover:bg-panel-2 hover:text-ink"
                  href="?runtime=clay"
                >
                  Clay
                </a>
              </FloatingPanel>

              <span
                className={`rounded-full border border-line bg-panel/90 px-2.5 py-1 text-[11px] backdrop-blur-md ${
                  warmStatus.state === 'timeout' || warmStatus.state === 'error'
                    ? 'text-red-300'
                    : 'text-ink-dim'
                }`}
              >
                {warmLabel}
              </span>

              {viewMode === 'camera' && (
                <label className="flex items-center gap-2 rounded-full border border-line bg-panel/90 px-2.5 py-1 text-[11px] text-ink backdrop-blur-md">
                  <input
                    type="checkbox"
                    checked={showBlocking}
                    onChange={(e) => setShowBlocking(e.target.checked)}
                  />
                  Show blocking
                </label>
              )}

              {exportUi.state === 'error' && (
                <p className="max-w-xs rounded-lg border border-red-900/60 bg-panel/95 px-2.5 py-2 text-[11px] leading-4 text-red-300 shadow-panel">
                  {exportUi.message}
                </p>
              )}
              {exportUi.state === 'done' && (
                <span className="rounded-full border border-line bg-panel/90 px-2.5 py-1 text-[11px] text-ink-dim">
                  Exported .mp4
                </span>
              )}
              {exportUi.state === 'cancelled' && (
                <span className="rounded-full border border-line bg-panel/90 px-2.5 py-1 text-[11px] text-ink-dim">
                  Export cancelled
                </span>
              )}
            </div>
          </div>

          {/* Left tool palette — Select / Pen (orbit only) */}
          {viewMode === 'orbit' && (
            <div className="pointer-events-none absolute left-3 top-1/2 z-20 -translate-y-1/2">
              <FloatingPanel className="pointer-events-auto flex flex-col gap-1 p-1.5">
                {(
                  [
                    { value: 'select' as const, label: 'Select', Icon: IconSelect },
                    { value: 'pen' as const, label: 'Pen', Icon: IconPen },
                  ] as const
                ).map((tool) => {
                  const active = editTool === tool.value
                  return (
                    <button
                      key={tool.value}
                      type="button"
                      title={tool.label}
                      onClick={() => setEditTool(tool.value)}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                        active
                          ? 'bg-accent text-white'
                          : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
                      }`}
                    >
                      <tool.Icon active={active} />
                      <span className="sr-only">{tool.label}</span>
                    </button>
                  )
                })}
                <div className="mx-1 my-0.5 h-px bg-line" />
                <button
                  type="button"
                  title="Clear path"
                  onClick={clearPath}
                  className="rounded-lg px-1.5 py-1.5 text-[10px] leading-tight text-ink-dim hover:bg-panel-2 hover:text-ink"
                >
                  Clear
                </button>
                <span className="px-1 pb-0.5 text-center text-[10px] tabular-nums text-ink-dim">
                  {anchorCount}
                  {!pathReady && anchorCount > 0 ? '+' : ''}
                </span>
              </FloatingPanel>
            </div>
          )}

          {/* Bottom transport — play / scrub */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-3">
            <FloatingPanel className="pointer-events-auto flex w-full max-w-xl items-center gap-3 px-3 py-2">
              <button
                type="button"
                disabled={!pathReady || exporting}
                title={playing ? 'Pause' : 'Play'}
                onClick={() => {
                  if (!pathReady) return
                  if (time >= 1 - 1e-6) setTime(0)
                  setPlaying((p) => !p)
                  setViewMode('camera')
                  setEditTool('select')
                }}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:opacity-40 ${
                  playing ? 'bg-accent text-white' : 'bg-panel-2 text-ink hover:bg-panel-3'
                }`}
              >
                {playing ? <IconPause /> : <IconPlay />}
                <span className="sr-only">{playing ? 'Pause' : 'Play'}</span>
              </button>
              <span className="w-[4.5rem] shrink-0 tabular-nums text-[11px] text-ink-dim">
                {clockLabel}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={time}
                disabled={!pathReady || exporting}
                onChange={(e) => {
                  setPlaying(false)
                  setTime(Number(e.target.value))
                }}
                className="w-full disabled:opacity-40"
                aria-label="Timeline"
              />
              <label className="flex shrink-0 items-center gap-1 text-[11px] text-ink-dim">
                <span className="sr-only">Duration seconds</span>
                <input
                  type="number"
                  min={MIN_SHOT_DURATION_S}
                  max={MAX_SHOT_DURATION_S}
                  step={0.5}
                  value={durationS}
                  disabled={exporting}
                  onChange={(e) => {
                    setPlaying(false)
                    setDurationS(clampShotDuration(Number(e.target.value)))
                  }}
                  className="w-12 rounded-md border border-line bg-panel-2 px-1.5 py-1 text-right tabular-nums text-ink disabled:opacity-40"
                  aria-label="Duration in seconds"
                />
                <span>s</span>
              </label>
              <span className="w-10 shrink-0 text-right tabular-nums text-[11px] text-ink-dim">
                {time.toFixed(2)}
              </span>
            </FloatingPanel>
          </div>

          {exporting && (
            <ExportOverlay progress={exportUi.progress} onCancel={cancelExport} />
          )}
        </>
      )}
    </div>
  )
}
