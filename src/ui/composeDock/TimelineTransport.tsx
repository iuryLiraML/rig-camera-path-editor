import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../../state/useEditorStore'
import { useRigStore } from '../../state/useRigStore'
import { useSceneStore } from '../../state/useSceneStore'
import { easeGroups, type EaseKind } from '../../lib/easing'
import { selectedKeyEase, setSelectedKeyEase } from '../../lib/timelineKey'
import { animateMenuItems, animateProperty } from '../../lib/animateProperty'
import { applyTogglePlayback } from '../../lib/playback'
import {
  durationFromFrameCount,
  formatTimecode,
  maxShotFrames,
  minShotFrames,
  MIN_SHOT_DURATION,
  MAX_SHOT_DURATION,
  SHOT_FPS_OPTIONS,
  shotFrameCount,
  type ShotFps,
} from '../../lib/timeView'
import { PlayIcon } from '../icons'

const PauseIcon = () => (
  <svg width={12} height={12} viewBox="0 0 16 16" fill="currentColor">
    <rect x="3.5" y="3" width="3.2" height="10" rx="1" />
    <rect x="9.3" y="3" width="3.2" height="10" rx="1" />
  </svg>
)

function AnimateMenu() {
  const [open, setOpen] = useState(false)
  const selection = useEditorStore((s) => s.selection)
  const cameraKind = useRigStore((s) => s.cameraKind)
  const items = animateMenuItems(selection, cameraKind)
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
        type="button"
        data-animate-menu
        title={
          items.length === 0
            ? 'Select a scene object to add Position, Rotation or Scale tracks'
            : 'Add a property track (creates the track and a key at the playhead)'
        }
        disabled={items.length === 0}
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md px-2.5 py-1 text-[11px] ${
          items.length === 0
            ? 'cursor-not-allowed text-ink-dim/50'
            : open
              ? 'bg-accent text-white'
              : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
        }`}
      >
        + Property
      </button>
      {open && items.length > 0 && (
        <div className="panel absolute left-0 top-8 z-30 w-40 p-1">
          {items.map((item) => (
            <button
              key={`${item.kind}-${item.channel}`}
              type="button"
              className="block w-full rounded-md px-2 py-1 text-left text-[11px] text-ink hover:bg-panel-2"
              onClick={() => {
                animateProperty(item)
                setOpen(false)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function toolClass(on: boolean) {
  return `rounded-md px-2.5 py-1 text-[11px] ${
    on ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
  }`
}

/** Custom list — native `<select>` on Windows paints a white OS popup over the dark dock. */
function FpsMenu({ fps }: { fps: ShotFps }) {
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
    <div ref={ref} className="relative flex items-center gap-1 px-2 py-1">
      <button
        type="button"
        aria-label="Shot frame rate"
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Frame rate of this shot and the MP4 export"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-0.5 bg-transparent text-[11px] tabular-nums text-ink outline-none"
      >
        {fps}
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          aria-hidden
          className="text-ink-dim"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1.6 2.8 4 5.3 6.4 2.8" />
        </svg>
      </button>
      <span className="text-[10px] text-ink-dim">fps</span>
      {open && (
        <div
          role="listbox"
          aria-label="Frame rate options"
          className="panel absolute right-0 top-[calc(100%+4px)] z-40 min-w-[4.75rem] p-1"
        >
          {SHOT_FPS_OPTIONS.map((rate) => (
            <button
              key={rate}
              type="button"
              role="option"
              aria-selected={rate === fps}
              className={`block w-full rounded-md px-2 py-1 text-left text-[11px] tabular-nums ${
                rate === fps ? 'bg-accent text-white' : 'text-ink hover:bg-panel-2'
              }`}
              onClick={() => {
                useRigStore.getState().setFps(rate)
                setOpen(false)
              }}
            >
              {rate}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Duration + fps as one composition timebase, the way VEED / AE keep
 * seconds, frames and frame rate next to each other.
 */
function TimebaseFields({ duration, fps }: { duration: number; fps: ShotFps }) {
  const frames = shotFrameCount(duration, fps)
  return (
    <div
      data-testid="shot-duration"
      className="flex items-center gap-2"
      title="Shot length in seconds. Changing fps keeps duration and resamples the frame count."
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-dim">Duration</span>
      <div className="flex items-stretch divide-x divide-line rounded-md bg-panel-2">
        <label className="flex items-center gap-1 px-2 py-1">
          <input
            type="number"
            aria-label="Shot duration in seconds"
            min={MIN_SHOT_DURATION}
            max={MAX_SHOT_DURATION}
            step={0.1}
            value={Number(duration.toFixed(2))}
            onChange={(e) => {
              const next = parseFloat(e.target.value)
              if (!Number.isFinite(next)) return
              useRigStore.getState().setDuration(next)
            }}
            className="w-10 bg-transparent text-right text-[11px] tabular-nums text-ink outline-none"
          />
          <span className="text-[10px] text-ink-dim">s</span>
        </label>
        <label className="flex items-center gap-1 px-2 py-1">
          <input
            type="number"
            aria-label="Shot duration in frames"
            min={minShotFrames(fps)}
            max={maxShotFrames(fps)}
            step={1}
            value={frames}
            onChange={(e) => {
              const next = parseInt(e.target.value, 10)
              if (!Number.isFinite(next)) return
              useRigStore.getState().setDuration(durationFromFrameCount(next, fps))
            }}
            className="w-11 bg-transparent text-right text-[11px] tabular-nums text-ink outline-none"
          />
          <span className="text-[10px] text-ink-dim">f</span>
        </label>
        <FpsMenu fps={fps} />
      </div>
    </div>
  )
}

export function TimelineTransport({
  playing,
  t,
  duration,
  fps,
  loop,
  ease,
}: {
  playing: boolean
  t: number
  duration: number
  fps: ShotFps
  loop: boolean
  ease: EaseKind
}) {
  const timelineEasing = useEditorStore((s) => s.timelineEasing)
  const easingLinked = useEditorStore((s) => s.easingLinked)
  const timelineGraph = useEditorStore((s) => s.timelineGraph)
  const selectedKeyframe = useEditorStore((s) => s.selectedKeyframe)

  return (
    <div className="relative z-10 flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1.5 px-3 pb-2 pt-1.5">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] font-medium text-ink">This shot</span>
        <span className="h-4 w-px shrink-0 bg-line" aria-hidden />
        <button
          title="Play / Pause (Space)"
          onClick={() => applyTogglePlayback()}
          className={`flex h-7 w-7 items-center justify-center rounded-md ${
            playing ? 'bg-accent text-white' : 'bg-panel-2 text-ink hover:bg-panel-3'
          }`}
        >
          {playing ? <PauseIcon /> : <PlayIcon size={12} />}
        </button>
        <span
          className="min-w-[5.75rem] text-[11px] tabular-nums text-ink"
          title={`${fps} fps — same as the MP4 export`}
        >
          {formatTimecode(t, duration, fps)} / {formatTimecode(1, duration, fps)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <button
          title="Repeat automatically"
          onClick={() => useRigStore.getState().setLoop(!loop)}
          className={toolClass(loop)}
        >
          Loop
        </button>
        <button
          title="Show spacing handles between keys — linger or rush without changing the path"
          onClick={() => useEditorStore.getState().toggleTimelineEasing()}
          className={toolClass(timelineEasing)}
        >
          Spacing
        </button>
        <button
          data-graph-toggle
          title="Graph Editor — edit animation curves like After Effects"
          onClick={() => useEditorStore.getState().toggleTimelineGraph()}
          className={toolClass(timelineGraph)}
        >
          Graph
        </button>
        <AnimateMenu />
        {timelineGraph && selectedKeyframe && (
          <span className="ml-1 flex items-center gap-0.5 border-l border-line pl-2">
            <button
              data-graph-ease="linear"
              title="Linear"
              onClick={() => setSelectedKeyEase('linear')}
              className="rounded-md px-1.5 py-1 text-[10px] text-ink-dim hover:bg-panel-2 hover:text-ink"
            >
              Linear
            </button>
            <button
              data-graph-ease="easy"
              title="Easy Ease"
              onClick={() => setSelectedKeyEase('cubicInOut')}
              className="rounded-md px-1.5 py-1 text-[10px] text-ink-dim hover:bg-panel-2 hover:text-ink"
            >
              Easy Ease
            </button>
            <button
              data-graph-ease="in"
              title="Ease In"
              onClick={() => setSelectedKeyEase('cubicIn')}
              className="rounded-md px-1.5 py-1 text-[10px] text-ink-dim hover:bg-panel-2 hover:text-ink"
            >
              Ease In
            </button>
            <button
              data-graph-ease="out"
              title="Ease Out"
              onClick={() => setSelectedKeyEase('cubicOut')}
              className="rounded-md px-1.5 py-1 text-[10px] text-ink-dim hover:bg-panel-2 hover:text-ink"
            >
              Ease Out
            </button>
          </span>
        )}
        {timelineEasing && (
          <span className="ml-1 flex items-center gap-1 border-l border-line pl-2">
            <button
              title="Link a key's incoming and outgoing weights"
              onClick={() => useEditorStore.getState().setEasingLinked(!easingLinked)}
              className={toolClass(easingLinked)}
            >
              Link
            </button>
            <button
              title="Reset all interval spacing to even"
              onClick={() => {
                useRigStore.getState().clearAllSpacing()
                useSceneStore.getState().clearAllObjectSpacing()
              }}
              className="rounded-md px-2.5 py-1 text-[11px] text-ink-dim hover:bg-panel-2 hover:text-ink"
            >
              Reset
            </button>
          </span>
        )}
        {selectedKeyframe && (
          <label className="ml-1 flex items-center gap-1.5 border-l border-line pl-2 text-[10px] text-ink-dim">
            Curve
            <select
              data-key-ease
              value={selectedKeyEase() ?? ease}
              onChange={(e) => setSelectedKeyEase(e.target.value as EaseKind)}
              title="Animation curve leaving the selected key"
              className="max-w-[9rem] rounded-md bg-panel-2 px-1.5 py-1 text-[11px] text-ink outline-none"
            >
              {easeGroups().map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.items.map((item) => (
                    <option key={item.kind} value={item.kind}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="ml-auto shrink-0">
        <TimebaseFields duration={duration} fps={fps} />
      </div>
    </div>
  )
}
