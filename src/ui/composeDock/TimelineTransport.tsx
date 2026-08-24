import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../../state/useEditorStore'
import { useRigStore } from '../../state/useRigStore'
import { useSceneStore } from '../../state/useSceneStore'
import { easeGroups, type EaseKind } from '../../lib/easing'
import { selectedKeyEase, setSelectedKeyEase } from '../../lib/timelineKey'
import { animateMenuItems, animateProperty } from '../../lib/animateProperty'
import { applyTogglePlayback } from '../../lib/playback'
import { formatTimecode, TIMELINE_FPS } from '../../lib/timeView'
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
        title={items.length === 0 ? 'Select an object, then + Animate' : 'Add a property track'}
        disabled={items.length === 0}
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md px-2 py-0.5 text-[11px] ${
          items.length === 0
            ? 'cursor-not-allowed text-ink-dim/50'
            : open
              ? 'bg-accent text-white'
              : 'text-ink-dim hover:text-ink'
        }`}
      >
        + Animate
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

export function TimelineTransport({
  playing,
  t,
  duration,
  loop,
  ease,
  frameCount,
}: {
  playing: boolean
  t: number
  duration: number
  loop: boolean
  ease: EaseKind
  frameCount: number
}) {
  const timelineEasing = useEditorStore((s) => s.timelineEasing)
  const easingLinked = useEditorStore((s) => s.easingLinked)
  const timelineGraph = useEditorStore((s) => s.timelineGraph)
  const selectedKeyframe = useEditorStore((s) => s.selectedKeyframe)

  return (
    <div className="flex items-center gap-3 px-3 pb-1.5 pt-1">
      <span className="text-[11px] font-medium text-ink">This shot</span>
      <span className="h-4 w-px shrink-0 bg-line" aria-hidden />
      <div className="flex items-center gap-1.5">
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
          className="min-w-[7.5rem] text-[11px] tabular-nums text-ink-dim"
          title={`${TIMELINE_FPS} fps — same as the MP4 export`}
        >
          {formatTimecode(t, duration)} / {formatTimecode(1, duration)}
          <span className="ml-1.5 text-[10px] opacity-70">{frameCount}f</span>
        </span>
      </div>
      <span className="h-4 w-px shrink-0 bg-line" aria-hidden />
      <div className="flex items-center gap-1">
        <button
          title="Repeat automatically"
          onClick={() => useRigStore.getState().setLoop(!loop)}
          className={`rounded-md px-2 py-0.5 text-[11px] ${
            loop ? 'bg-accent text-white' : 'text-ink-dim hover:text-ink'
          }`}
        >
          Loop
        </button>
        <button
          title="Adjust interval spacing without changing the trajectory"
          onClick={() => useEditorStore.getState().toggleTimelineEasing()}
          className={`rounded-md px-2 py-0.5 text-[11px] ${
            timelineEasing ? 'bg-accent text-white' : 'text-ink-dim hover:text-ink'
          }`}
        >
          Easing
        </button>
        <button
          data-graph-toggle
          title="Graph Editor — edit animation curves like After Effects"
          onClick={() => useEditorStore.getState().toggleTimelineGraph()}
          className={`rounded-md px-2 py-0.5 text-[11px] ${
            timelineGraph ? 'bg-accent text-white' : 'text-ink-dim hover:text-ink'
          }`}
        >
          Graph
        </button>
        <AnimateMenu />
        {timelineGraph && selectedKeyframe && (
          <span className="flex items-center gap-0.5">
            <button
              data-graph-ease="linear"
              title="Linear"
              onClick={() => setSelectedKeyEase('linear')}
              className="rounded-md px-1.5 py-0.5 text-[10px] text-ink-dim hover:bg-panel-2 hover:text-ink"
            >
              Linear
            </button>
            <button
              data-graph-ease="easy"
              title="Easy Ease"
              onClick={() => setSelectedKeyEase('cubicInOut')}
              className="rounded-md px-1.5 py-0.5 text-[10px] text-ink-dim hover:bg-panel-2 hover:text-ink"
            >
              Easy Ease
            </button>
            <button
              data-graph-ease="in"
              title="Ease In"
              onClick={() => setSelectedKeyEase('cubicIn')}
              className="rounded-md px-1.5 py-0.5 text-[10px] text-ink-dim hover:bg-panel-2 hover:text-ink"
            >
              Ease In
            </button>
            <button
              data-graph-ease="out"
              title="Ease Out"
              onClick={() => setSelectedKeyEase('cubicOut')}
              className="rounded-md px-1.5 py-0.5 text-[10px] text-ink-dim hover:bg-panel-2 hover:text-ink"
            >
              Ease Out
            </button>
          </span>
        )}
        {timelineEasing && (
          <>
            <button
              title="Link a key's incoming and outgoing weights"
              onClick={() => useEditorStore.getState().setEasingLinked(!easingLinked)}
              className={`rounded-md px-2 py-0.5 text-[11px] ${
                easingLinked ? 'bg-accent text-white' : 'text-ink-dim hover:text-ink'
              }`}
            >
              Link
            </button>
            <button
              title="Reset all interval spacing to even"
              onClick={() => {
                useRigStore.getState().clearAllSpacing()
                useSceneStore.getState().clearAllObjectSpacing()
              }}
              className="rounded-md px-2 py-0.5 text-[11px] text-ink-dim hover:text-ink"
            >
              Reset
            </button>
          </>
        )}
      </div>
      {selectedKeyframe && (
        <label className="flex items-center gap-1 text-[10px] text-ink-dim">
          Curve
          <select
            data-key-ease
            value={selectedKeyEase() ?? ease}
            onChange={(e) => setSelectedKeyEase(e.target.value as EaseKind)}
            title="Animation curve leaving the selected key"
            className="max-w-[9rem] rounded-md bg-panel-2 px-1.5 py-0.5 text-[11px] text-ink outline-none"
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
  )
}
