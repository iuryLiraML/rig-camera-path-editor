import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useCameraReady } from '../state/cameraPathLink'
import { useEditorStore, type SelectableId, type SelectedTimelineKey } from '../state/useEditorStore'
import {
  DEFAULT_SPACING,
  inHandleU,
  outHandleU,
  uToInW,
  uToOutW,
} from '../lib/intervalSpacing'
import { useRigStore, type RigChannel } from '../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { useSceneStore, type Transform } from '../state/useSceneStore'
import {
  evalModelTransform,
  evalProgress,
  evalValue,
  evalVec3,
  KEY_MERGE_EPS,
  keyOutgoingBezier,
  keysForObjectChannel,
  OBJECT_CHANNEL_LABELS,
  OBJECT_CHANNELS,
  objectKeyChannel,
  type ModelKey,
  type ObjectChannel,
  type ProgressKey,
} from '../lib/keyframes'
import { easeGroups, type EaseKind } from '../lib/easing'
import {
  clampChannelValue,
  normalizeInRange,
  plotRange,
  RANGE_FOV,
  RANGE_LOOK,
  RANGE_PROGRESS,
  RANGE_ROLL,
  RANGE_UNIT,
  valueFromLanePointer,
  valueToLaneY,
  type ValueRange,
} from '../lib/lanePlot'
import {
  insertChannelKeyAt,
  selectedKeyEase,
  setSelectedKeyEase,
} from '../lib/timelineKey'
import { applyCameraPreset, PRESETS } from '../lib/presets'
import {
  clampTimeView,
  formatTimecode,
  FULL_TIME_VIEW,
  panTimeView,
  rulerMarks,
  shotFrameCount,
  timeInView,
  timeToX,
  TIMELINE_FPS,
  wheelZoomFactor,
  xToTime,
  zoomAround,
  type TimeView,
} from '../lib/timeView'
import { CAMERA_CHANNELS, FX_PARAM_CHANNELS } from './cameraChannels'
import { GraphEditor, buildGraphChannels } from './GraphEditor'
import { normalizeSamples, sampleOverTime, TrackCurve } from './TrackCurve'
import {
  GUTTER,
  TIMELINE_HEIGHT_DEFAULT,
  TIMELINE_HEIGHT_MAX,
  TIMELINE_MIN,
  chromeBand,
  useViewportInsets,
  useWindowSize,
} from './viewportInsets'
import { saveCurrentAsShot } from '../lib/projects'
import { applyTogglePlayback } from '../lib/playback'
import { PlayIcon } from './icons'
import { ComposeDockTabs } from './ComposeDockTabs'

/** height of the docked timeline, used by other floating UI to move out of the way */
export const TIMELINE_HEIGHT = TIMELINE_HEIGHT_DEFAULT

const TimeViewCtx = createContext<TimeView>(FULL_TIME_VIEW)

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** seconds → x% and back, shared by ruler/tracks so everything lines up */
function timeFromEvent(e: { clientX: number }, lane: HTMLElement, view: TimeView) {
  const rect = lane.getBoundingClientRect()
  const x = (e.clientX - rect.left) / Math.max(1e-6, rect.width)
  return xToTime(x, view)
}

/** AE-style divider: drag the top edge; up grows the dock. */
function TimelineResizeHandle() {
  return (
    <button
      type="button"
      aria-label="Resize timeline"
      data-timeline-resize
      title="Drag to resize the timeline"
      className="absolute inset-x-0 -top-px z-30 h-2 cursor-ns-resize"
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const startY = e.clientY
        const startH = useEditorStore.getState().timelineHeight
        const move = (ev: PointerEvent) => {
          useEditorStore
            .getState()
            .setTimelineHeight(clamp(startH + (startY - ev.clientY), TIMELINE_MIN, TIMELINE_HEIGHT_MAX))
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    />
  )
}

/** Full-shot overview bar. Drag the window to pan; click outside it to jump. */
function TimeNavigator({
  view,
  onChange,
}: {
  view: TimeView
  onChange: (view: TimeView) => void
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; start: number } | null>(null)

  return (
    <div className="flex h-3 shrink-0 items-center gap-2 pt-1">
      <div className="w-24 shrink-0" />
      <div
        ref={barRef}
        data-time-navigator
        title="Drag to pan the time view"
        className="relative h-2 min-w-0 flex-1 cursor-pointer rounded-sm bg-panel-2"
        onPointerDown={(e) => {
          const bar = barRef.current
          if (!bar) return
          const rect = bar.getBoundingClientRect()
          const x = (e.clientX - rect.left) / Math.max(1e-6, rect.width)
          let start = view.start
          if (x < view.start || x > view.start + view.span) {
            const next = clampTimeView(x - view.span / 2, view.span)
            onChange(next)
            start = next.start
          }
          drag.current = { x: e.clientX, start }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current || !barRef.current) return
          const dx =
            (e.clientX - drag.current.x) / Math.max(1e-6, barRef.current.getBoundingClientRect().width)
          onChange(clampTimeView(drag.current.start + dx, view.span))
        }}
        onPointerUp={(e) => {
          drag.current = null
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            /* pointer may be gone */
          }
        }}
      >
        <div
          className="absolute top-0 h-full rounded-sm bg-accent/40 ring-1 ring-accent/60"
          style={{ left: `${view.start * 100}%`, width: `${view.span * 100}%` }}
        />
      </div>
      <div className="w-6 shrink-0" />
    </div>
  )
}

const PauseIcon = () => (
  <svg width={12} height={12} viewBox="0 0 16 16" fill="currentColor">
    <rect x="3.5" y="3" width="3.2" height="10" rx="1" />
    <rect x="9.3" y="3" width="3.2" height="10" rx="1" />
  </svg>
)

function Keyframe({
  id,
  time,
  color,
  title,
  selected,
  topPct,
  onMove,
  onMoveValue,
  onDelete,
  onSelect,
}: {
  id: string
  time: number
  color: string
  title: string
  selected: boolean
  topPct?: number
  onMove: (id: string, time: number) => void
  onMoveValue?: (id: string, value: number) => void
  onDelete: (id: string) => void
  onSelect: (id: string) => void
}) {
  const dragging = useRef(false)
  const view = useContext(TimeViewCtx)

  return (
    <button
      data-timeline-key={id}
      data-selected-key={selected ? 'true' : undefined}
      title={`${title} — drag to move · Delete or double-click to remove`}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onDelete(id)
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        onSelect(id)
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const lane = e.currentTarget.parentElement
        if (!lane) return
        onMove(id, timeFromEvent(e, lane, view))
        if (onMoveValue) onMoveValue(id, valueFromLanePointer(e.clientY, lane, onMoveValueRange(lane)))
      }}
      onPointerUp={(e) => {
        dragging.current = false
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          /* pointer may be gone */
        }
      }}
      className={`absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-move rounded-[2px] border border-black/30 hover:scale-125 ${
        selected ? 'scale-125 ring-2 ring-white' : ''
      }`}
      style={{
        left: `${timeToX(time, view) * 100}%`,
        top: `${topPct ?? 50}%`,
        backgroundColor: color,
      }}
    />
  )
}

function onMoveValueRange(lane: HTMLElement): ValueRange {
  const lo = Number(lane.dataset.rangeLo)
  const hi = Number(lane.dataset.rangeHi)
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-9) {
    return RANGE_UNIT
  }
  return { lo, hi }
}

/**
 * One Cascadeur-style spacing handle on an interval. Dragging remaps time
 * inside the segment; the keyed values (and so the trajectory) stay put.
 */
function EaseHandle({
  t0,
  t1,
  side,
  weight,
  color,
  onChange,
}: {
  t0: number
  t1: number
  side: 'in' | 'out'
  weight: number
  color: string
  onChange: (weight: number) => void
}) {
  const dragging = useRef(false)
  const view = useContext(TimeViewCtx)
  const span = t1 - t0
  if (span < 1e-4) return null
  const local = side === 'out' ? outHandleU(weight) : inHandleU(weight)
  const time = t0 + span * local

  return (
    <button
      data-ease-handle={side}
      title={
        side === 'out'
          ? 'Outgoing spacing — drag toward the key to linger, away to rush'
          : 'Incoming spacing — drag toward the key to linger, away to rush'
      }
      onPointerDown={(e) => {
        e.stopPropagation()
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const lane = e.currentTarget.parentElement
        if (!lane) return
        const u = (timeFromEvent(e, lane, view) - t0) / span
        onChange(side === 'out' ? uToOutW(u) : uToInW(u))
      }}
      onPointerUp={(e) => {
        dragging.current = false
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          /* pointer may be gone */
        }
      }}
      className="absolute top-1/2 z-[9] h-2 w-2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border border-black/40 hover:scale-125"
      style={{ left: `${timeToX(time, view) * 100}%`, backgroundColor: color, opacity: 0.85 }}
    />
  )
}

function BezierHandles({
  t0,
  t1,
  v0,
  v1,
  bezier,
  range,
  color,
  onChange,
}: {
  t0: number
  t1: number
  v0: number
  v1: number
  bezier: [number, number, number, number]
  range: ValueRange
  color: string
  onChange: (bezier: [number, number, number, number]) => void
}) {
  const dragging = useRef<1 | 2 | null>(null)
  const view = useContext(TimeViewCtx)
  const span = t1 - t0
  const vspan = v1 - v0
  if (span < 1e-4 || Math.abs(vspan) < 1e-6) return null
  const [x1, y1, x2, y2] = bezier
  const pts = [
    { which: 1 as const, x: x1, y: y1 },
    { which: 2 as const, x: x2, y: y2 },
  ]
  const x0 = t0 * 100
  const x3 = t1 * 100
  const yStart = valueToLaneY(v0, range)
  const yEnd = valueToLaneY(v1, range)

  const moveHandle = (which: 1 | 2, e: { clientX: number; clientY: number }, lane: HTMLElement) => {
    const time = timeFromEvent(e, lane, view)
    const value = valueFromLanePointer(e.clientY, lane, range)
    const nx = Math.min(0.98, Math.max(0.02, (time - t0) / span))
    const ny = (value - v0) / vspan
    onChange(which === 1 ? [nx, ny, x2, y2] : [x1, y1, nx, ny])
  }

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`${view.start * 100} 0 ${view.span * 100} 100`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {pts.map((pt) => {
          const hx = (t0 + span * pt.x) * 100
          const hy = valueToLaneY(v0 + vspan * pt.y, range)
          const fromX = pt.which === 1 ? x0 : x3
          const fromY = pt.which === 1 ? yStart : yEnd
          return (
            <line
              key={pt.which}
              x1={fromX}
              y1={fromY}
              x2={hx}
              y2={hy}
              stroke={color}
              strokeOpacity={0.55}
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </svg>
      {pts.map((pt) => {
        const time = t0 + span * pt.x
        const value = v0 + vspan * pt.y
        return (
          <button
            key={pt.which}
            data-bezier-handle={pt.which}
            title="Drag to edit the animation curve"
            onPointerDown={(e) => {
              e.stopPropagation()
              dragging.current = pt.which
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (dragging.current !== pt.which) return
              const lane = e.currentTarget.parentElement
              if (lane) moveHandle(pt.which, e, lane)
            }}
            onPointerUp={(e) => {
              dragging.current = null
              try {
                e.currentTarget.releasePointerCapture(e.pointerId)
              } catch {
                /* pointer may be gone */
              }
            }}
            className="absolute z-[11] h-2 w-2 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-white/70 hover:scale-125"
            style={{
              left: `${timeToX(time, view) * 100}%`,
              top: `${valueToLaneY(value, range)}%`,
              backgroundColor: color,
            }}
          />
        )
      })}
    </>
  )
}

function ClipRange({
  start,
  end,
  fadeIn,
  fadeOut,
  duration,
  onChange,
}: {
  start: number
  end: number
  fadeIn: number
  fadeOut: number
  duration: number
  onChange: (start: number, end: number) => void
}) {
  const view = useContext(TimeViewCtx)
  const left = Math.min(start, end)
  const right = Math.max(start, end)
  const fadeInT = duration > 0 ? fadeIn / duration : 0
  const fadeOutT = duration > 0 ? fadeOut / duration : 0
  const x0 = timeToX(left, view)
  const x1 = timeToX(right, view)

  const dragEdge = (
    edge: 'start' | 'end',
    e: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation()
    const lane = e.currentTarget.parentElement
    if (!lane) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const next = timeFromEvent(ev, lane, view)
      if (edge === 'start') onChange(Math.min(next, right), right)
      else onChange(left, Math.max(next, left))
    }
    const up = (ev: PointerEvent) => {
      move(ev)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <>
      <div
        className="absolute top-1 bottom-1 rounded-sm bg-accent/25"
        style={{ left: `${x0 * 100}%`, width: `${Math.max(0.5, (x1 - x0) * 100)}%` }}
      />
      {fadeInT > 1e-4 && (
        <div
          className="absolute top-1 bottom-1 w-px bg-accent/50"
          style={{ left: `${timeToX(left + fadeInT, view) * 100}%` }}
        />
      )}
      {fadeOutT > 1e-4 && (
        <div
          className="absolute top-1 bottom-1 w-px bg-accent/50"
          style={{ left: `${timeToX(right - fadeOutT, view) * 100}%` }}
        />
      )}
      <button
        title="Trim clip start"
        onPointerDown={(e) => dragEdge('start', e)}
        className="absolute top-0.5 bottom-0.5 z-10 w-1.5 -translate-x-1/2 cursor-ew-resize rounded-sm bg-accent"
        style={{ left: `${x0 * 100}%` }}
      />
      <button
        title="Trim clip end"
        onPointerDown={(e) => dragEdge('end', e)}
        className="absolute top-0.5 bottom-0.5 z-10 w-1.5 -translate-x-1/2 cursor-ew-resize rounded-sm bg-accent"
        style={{ left: `${x1 * 100}%` }}
      />
    </>
  )
}

function Track({
  label,
  selectId,
  color,
  keys,
  onMove,
  onDelete,
  onAdd,
  onAddAt,
  addTitle,
  note,
  curve,
  range,
  valueRange,
  onMoveValue,
  onBezier,
  onSpacing,
  selectedId,
  onSelectKey,
  trackId,
  defaultEase,
}: {
  label: string
  selectId: SelectableId
  color: string
  keys: {
    id: string
    time: number
    title: string
    value?: number
    ease?: EaseKind
    easeBezier?: [number, number, number, number]
    easeIn?: number
    easeOut?: number
    implicit?: boolean
  }[]
  onMove: (id: string, time: number) => void
  onDelete: (id: string) => void
  onAdd: () => void
  onAddAt?: (time: number) => void
  addTitle: string
  /** when set, the track is path-driven: show this note instead of keyframes/add */
  note?: string
  /** the channel's value over time, normalized 0..1, plotted in the lane */
  curve?: number[]
  range?: {
    start: number
    end: number
    fadeIn: number
    fadeOut: number
    duration: number
    onChange: (start: number, end: number) => void
  }
  valueRange?: ValueRange
  onMoveValue?: (id: string, value: number) => void
  onBezier?: (id: string, bezier: [number, number, number, number]) => void
  onSpacing?: (id: string, side: 'in' | 'out', weight: number) => void
  selectedId?: string | null
  onSelectKey?: (id: string) => void
  trackId?: string
  defaultEase?: EaseKind
}) {
  const selection = useEditorStore((s) => s.selection)
  const easingOn = useEditorStore((s) => s.timelineEasing)
  const selected = selection === selectId
  const sorted = [...keys].sort((a, b) => a.time - b.time)
  const view = useContext(TimeViewCtx)
  const selectedOnTrack = selectedId ? keys.some((k) => k.id === selectedId && !k.implicit) : false
  const outgoing = selectedId
    ? sorted.findIndex((k) => k.id === selectedId)
    : -1
  const leftKey = outgoing >= 0 ? sorted[outgoing] : null
  const rightKey = outgoing >= 0 ? sorted[outgoing + 1] : null
  const showBezier =
    Boolean(onBezier && valueRange && leftKey && rightKey && leftKey.value !== undefined && rightKey.value !== undefined)

  const hitOnHandle = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(target.closest('[data-timeline-key],[data-ease-handle],[data-bezier-handle]'))

  return (
    <div className="flex h-10 items-center gap-2" data-track={trackId}>
      <button
        onClick={() => useEditorStore.getState().select(selected ? null : selectId)}
        className={`w-24 shrink-0 truncate rounded-md px-2 py-1 text-left text-[11px] ${
          selected ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
        }`}
      >
        {label}
      </button>
      <div
        data-lane
        data-range-lo={valueRange?.lo}
        data-range-hi={valueRange?.hi}
        className="relative h-full min-w-0 flex-1 cursor-crosshair overflow-hidden rounded-md bg-panel-2/50"
        title="Click to move playhead · Alt+click or double-click to add a key"
        onPointerDown={(e) => {
          if (hitOnHandle(e.target)) return
          const time = timeFromEvent(e, e.currentTarget, view)
          useRigStore.getState().setPlaying(false)
          useRigStore.getState().setT(time)
          useEditorStore.getState().selectKeyframe(null)
          if (e.altKey && onAddAt) {
            e.preventDefault()
            onAddAt(time)
          }
        }}
        onDoubleClick={(e) => {
          if (hitOnHandle(e.target) || !onAddAt) return
          onAddAt(timeFromEvent(e, e.currentTarget, view))
        }}
      >
        <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-px bg-line" />
        {range && (
          <ClipRange
            start={range.start}
            end={range.end}
            fadeIn={range.fadeIn}
            fadeOut={range.fadeOut}
            duration={range.duration}
            onChange={range.onChange}
          />
        )}
        {curve && !note && <TrackCurve samples={curve} color={color} view={view} />}
        {note ? (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] italic text-ink-dim">
            {note}
          </span>
        ) : (
          <>
            {keys
              .filter((k) => !k.implicit)
              .map((k) => (
                <Keyframe
                  key={k.id}
                  id={k.id}
                  time={k.time}
                  color={color}
                  title={k.title}
                  selected={k.id === selectedId}
                  topPct={
                    valueRange && k.value !== undefined ? valueToLaneY(k.value, valueRange) : undefined
                  }
                  onMove={onMove}
                  onMoveValue={onMoveValue}
                  onDelete={onDelete}
                  onSelect={(id) => onSelectKey?.(id)}
                />
              ))}
            {showBezier && leftKey && rightKey && valueRange && onBezier && (
              <BezierHandles
                t0={leftKey.time}
                t1={rightKey.time}
                v0={leftKey.value as number}
                v1={rightKey.value as number}
                bezier={keyOutgoingBezier(
                  {
                    ease: leftKey.ease,
                    easeBezier: leftKey.easeBezier,
                  },
                  defaultEase ?? 'linear',
                )}
                range={valueRange}
                color={color}
                onChange={(bezier) => onBezier(leftKey.id, bezier)}
              />
            )}
            {easingOn &&
              onSpacing &&
              sorted.slice(0, -1).map((left, i) => {
                const right = sorted[i + 1]
                return (
                  <span key={`${left.id}-${right.id}`}>
                    <EaseHandle
                      t0={left.time}
                      t1={right.time}
                      side="out"
                      weight={left.easeOut ?? DEFAULT_SPACING}
                      color={color}
                      onChange={(w) => onSpacing(left.id, 'out', w)}
                    />
                    <EaseHandle
                      t0={left.time}
                      t1={right.time}
                      side="in"
                      weight={right.easeIn ?? DEFAULT_SPACING}
                      color={color}
                      onChange={(w) => onSpacing(right.id, 'in', w)}
                    />
                  </span>
                )
              })}
          </>
        )}
      </div>
      {note ? (
        <span className="w-6 shrink-0" />
      ) : selectedOnTrack && selectedId ? (
        <button
          data-delete-key
          onClick={() => onDelete(selectedId)}
          title="Delete selected keyframe (Delete)"
          className="w-6 shrink-0 rounded-md py-1 text-[13px] leading-none text-ink-dim hover:bg-panel-2 hover:text-ink"
        >
          ×
        </button>
      ) : (
        <button
          data-add-key
          onClick={onAdd}
          title={addTitle}
          className="w-6 shrink-0 rounded-md py-1 text-[13px] leading-none text-ink-dim hover:bg-panel-2 hover:text-ink"
        >
          +
        </button>
      )}
    </div>
  )
}

function applyChannelSpacing(
  channel: RigChannel,
  id: string,
  side: 'in' | 'out',
  weight: number,
) {
  const linked = useEditorStore.getState().easingLinked
  useRigStore
    .getState()
    .setKeySpacing(channel, id, side === 'out' ? { easeOut: weight } : { easeIn: weight }, linked)
}

/** Camera path always has implicit 0/1 ends so easing works with zero user keys. */
function progressLaneKeys(keys: ProgressKey[], duration: number) {
  const pts: {
    id: string
    time: number
    title: string
    value?: number
    ease?: EaseKind
    easeBezier?: [number, number, number, number]
    easeIn?: number
    easeOut?: number
    implicit?: boolean
  }[] = keys.map((k) => ({
    id: k.id,
    time: k.time,
    title: `${(k.time * duration).toFixed(1)}s → ${Math.round(k.progress * 100)}% of path`,
    value: k.progress,
    ease: k.ease,
    easeBezier: k.easeBezier,
    easeIn: k.easeIn,
    easeOut: k.easeOut,
  }))
  if (!pts.some((p) => p.time <= 0.001)) {
    pts.push({ id: 'implicit-start', time: 0, title: 'Start of path', value: 0, implicit: true })
  }
  if (!pts.some((p) => p.time >= 0.999)) {
    pts.push({ id: 'implicit-end', time: 1, title: 'End of path', value: 1, implicit: true })
  }
  return pts
}

function selectRigKey(channel: RigChannel, id: string) {
  useEditorStore.getState().selectTimelineKey({ kind: 'rig', channel, id }, 'cinema-camera')
}

function rigSelectedId(sel: SelectedTimelineKey | null, channel: RigChannel) {
  return sel?.kind === 'rig' && sel.channel === channel ? sel.id : null
}

function applyProgressSpacing(id: string, side: 'in' | 'out', weight: number) {
  const rig = useRigStore.getState()
  let keyId = id
  if (id === 'implicit-start') {
    rig.upsertProgressKey(0, 0)
    keyId =
      useRigStore.getState().progressKeys.find((k) => Math.abs(k.time) < KEY_MERGE_EPS)?.id ?? id
  } else if (id === 'implicit-end') {
    rig.upsertProgressKey(1, 1)
    keyId =
      useRigStore.getState().progressKeys.find((k) => Math.abs(k.time - 1) < KEY_MERGE_EPS)?.id ?? id
  }
  applyChannelSpacing('progress', keyId, side, weight)
}

/** how far an object channel has moved from its first keyframed value, normalized */
function objectChannelCurve(
  keys: ModelKey[],
  channel: ObjectChannel,
  fallback: Transform,
  ease: EaseKind,
): number[] | undefined {
  const used = keysForObjectChannel(keys, channel)
  if (used.length < 2) return undefined
  const first = [...used].sort((a, b) => a.time - b.time)[0].transform[channel]
  return normalizeSamples(
    sampleOverTime((time) => {
      const pose = evalModelTransform(time, keys, ease, fallback)
      if (!pose) return 0
      const value = pose[channel]
      return Math.hypot(value[0] - first[0], value[1] - first[1], value[2] - first[2])
    }),
  )
}

export function Timeline() {
  const hasPath = useCameraReady()
  const playing = useRigStore((s) => s.playing)
  const t = useRigStore((s) => s.t)
  const duration = useRigStore((s) => s.duration)
  const loop = useRigStore((s) => s.loop)
  const ease = useRigStore((s) => s.ease)
  const progressKeys = useRigStore((s) => s.progressKeys)
  const fovKeys = useRigStore((s) => s.fovKeys)
  const rollKeys = useRigStore((s) => s.rollKeys)
  const intensityKeys = useRigStore((s) => s.intensityKeys)
  const fadeInKeys = useRigStore((s) => s.fadeInKeys)
  const fadeOutKeys = useRigStore((s) => s.fadeOutKeys)
  const ampPosKeys = useRigStore((s) => s.ampPosKeys)
  const ampRotKeys = useRigStore((s) => s.ampRotKeys)
  const freqKeys = useRigStore((s) => s.freqKeys)
  const targetKeys = useRigStore((s) => s.targetKeys)
  const lookOffsetKeys = useRigStore((s) => s.lookOffsetKeys)
  const fov = useRigStore((s) => s.fov)
  const roll = useRigStore((s) => s.roll)
  const target = useRigStore((s) => s.target)
  const lookOffset = useRigStore((s) => s.lookOffset)
  const targetObjectId = useRigStore((s) => s.targetObjectId)
  const cameraNoise = useRigStore((s) => s.cameraNoise)
  const objects = useSceneStore((s) => s.objects)
  const paths = usePathStore((s) => s.paths)
  const playMode = useEditorStore((s) => s.playMode)
  const timelineEasing = useEditorStore((s) => s.timelineEasing)
  const easingLinked = useEditorStore((s) => s.easingLinked)
  const timelineView = useEditorStore((s) => s.timelineView)
  const selectedKeyframe = useEditorStore((s) => s.selectedKeyframe)
  const timelineGraph = useEditorStore((s) => s.timelineGraph)

  const insets = useViewportInsets()
  const win = useWindowSize()
  const band = chromeBand(insets, win.w)
  const scrubbing = useRef(false)
  const rulerRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)

  /*
   * Every hook must run before the early returns below. These four sat after the
   * "no camera path" return, so the component ran 60 hooks while empty and 64
   * once a path existed — React threw "Rendered more hooks than during the
   * previous render" and unmounted the whole editor to a blank screen.
   *
   * Curves depend on the keyframes and the default ease, never on the playhead,
   * so playback does not recompute them.
   */
  const progressPlot = useMemo(() => {
    const values = sampleOverTime((time) => evalProgress(time, progressKeys, ease))
    const range = plotRange(
      [...values, ...progressKeys.map((k) => k.progress)],
      RANGE_PROGRESS,
    )
    return { curve: normalizeInRange(values, range), range }
  }, [progressKeys, ease])
  const fovPlot = useMemo(() => {
    const values = sampleOverTime((time) => evalValue(time, fovKeys, fov, ease))
    const range = plotRange([...values, ...fovKeys.map((k) => k.value)], RANGE_FOV)
    return { curve: normalizeInRange(values, range), range }
  }, [fovKeys, fov, ease])
  const rollPlot = useMemo(() => {
    const values = sampleOverTime((time) => evalValue(time, rollKeys, roll, ease))
    const range = plotRange([...values, ...rollKeys.map((k) => k.value)], RANGE_ROLL)
    return { curve: normalizeInRange(values, range), range }
  }, [rollKeys, roll, ease])
  const targetPlot = useMemo(() => {
    const values = sampleOverTime((time) => evalVec3(time, targetKeys, target, ease)[1])
    const range = plotRange([...values, ...targetKeys.map((k) => k.value[1])], RANGE_LOOK)
    return { curve: normalizeInRange(values, range), range }
  }, [targetKeys, target, ease])
  const lookOffsetPlot = useMemo(() => {
    const values = sampleOverTime((time) => evalVec3(time, lookOffsetKeys, lookOffset, ease)[1])
    const range = plotRange([...values, ...lookOffsetKeys.map((k) => k.value[1])], RANGE_LOOK)
    return { curve: normalizeInRange(values, range), range }
  }, [lookOffsetKeys, lookOffset, ease])
  const intensityPlot = useMemo(() => {
    const values = sampleOverTime((time) =>
      evalValue(time, intensityKeys, cameraNoise.intensity, ease),
    )
    const range = plotRange([...values, ...intensityKeys.map((k) => k.value)], RANGE_UNIT)
    return { curve: normalizeInRange(values, range), range }
  }, [intensityKeys, cameraNoise.intensity, ease])
  const fxParamBag = {
    fadeIn: fadeInKeys,
    fadeOut: fadeOutKeys,
    ampPos: ampPosKeys,
    ampRot: ampRotKeys,
    freq: freqKeys,
  }
  const fxParamFallback = {
    fadeIn: cameraNoise.fadeIn,
    fadeOut: cameraNoise.fadeOut,
    ampPos: cameraNoise.ampPos,
    ampRot: cameraNoise.ampRot,
    freq: cameraNoise.freq,
  }
  const fxParamPlots = useMemo(() => {
    const plots: Partial<Record<keyof typeof fxParamBag, { curve: number[]; range: ValueRange }>> = {}
    for (const channel of FX_PARAM_CHANNELS) {
      const keys = fxParamBag[channel.id]
      const values = sampleOverTime((time) =>
        evalValue(time, keys, fxParamFallback[channel.id], ease),
      )
      const range = plotRange([...values, ...keys.map((k) => k.value)], RANGE_UNIT)
      plots[channel.id] = { curve: normalizeInRange(values, range), range }
    }
    return plots
  }, [fadeInKeys, fadeOutKeys, ampPosKeys, ampRotKeys, freqKeys, cameraNoise, ease])
  const channelPlots = {
    fov: fovPlot,
    roll: rollPlot,
    target: targetPlot,
    lookOffset: lookOffsetPlot,
  }

  const applyWheelZoom = (e: { deltaX: number; deltaY: number; shiftKey: boolean; clientX: number; preventDefault: () => void }) => {
    const lane = rulerRef.current
    if (!lane) return
    e.preventDefault()
    const view = useEditorStore.getState().timelineView
    const pan = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.25
    if (pan) {
      const pixels = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      useEditorStore
        .getState()
        .setTimelineView(panTimeView(view, (pixels / Math.max(1, lane.clientWidth)) * view.span))
      return
    }
    useEditorStore
      .getState()
      .setTimelineView(zoomAround(view, timeFromEvent(e, lane, view), wheelZoomFactor(e.deltaY)))
  }

  useEffect(() => {
    const dock = dockRef.current
    if (!dock) return
    const onWheel = (e: WheelEvent) => applyWheelZoom(e)
    dock.addEventListener('wheel', onWheel, { passive: false })
    return () => dock.removeEventListener('wheel', onWheel)
  }, [hasPath, playMode])

  if (playMode) return null

  // Without a camera path there is nothing to scrub, but hiding the whole dock
  // left the editor with no visible transport or keyframe controls at all — show
  // the empty state with the one-click ways to create a path instead.
  if (!hasPath) {
    return (
      <div
        className="panel absolute z-20 flex items-center justify-between gap-4 px-3 py-3"
        style={{ left: band.left, width: band.width, bottom: GUTTER, height: insets.timelineHeight }}
      >
        <TimelineResizeHandle />
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-ink">No camera path yet</p>
          <p className="mt-1 text-[10px] leading-4 text-ink-dim">
            The timeline, keyframes and video export need a path. Pick a ready-made move or draw
            your own with the pen tool (P).
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.kind}
              onClick={() => applyCameraPreset(preset.kind)}
              title={preset.hint}
              className="rounded-md bg-panel-2 px-2.5 py-1 text-[11px] text-ink hover:bg-panel-3"
            >
              {preset.label}
            </button>
          ))}
          <button
            onClick={() => useEditorStore.getState().setTool('pen')}
            title="Draw the camera path by clicking in the viewport"
            className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent/85"
          >
            Draw path (P)
          </button>
        </div>
      </div>
    )
  }

  const rig = useRigStore.getState()
  const scene = useSceneStore.getState()

  const scrub = (e: ReactPointerEvent) => {
    if (!rulerRef.current) return
    rig.setPlaying(false)
    rig.setT(timeFromEvent(e, rulerRef.current, timelineView))
  }

  const ticks = rulerMarks(duration, timelineView, TIMELINE_FPS)
  const playX = timeToX(t, timelineView)
  const frameCount = shotFrameCount(duration, TIMELINE_FPS)

  return (
    <TimeViewCtx.Provider value={timelineView}>
    <div
      ref={dockRef}
      data-timeline-dock
      className="panel absolute z-20 flex flex-col px-3 py-2"
      style={{ left: band.left, width: band.width, bottom: GUTTER, height: insets.timelineHeight }}
      onWheel={(e) => applyWheelZoom(e)}
    >
      <TimelineResizeHandle />
      {/* transport: tabs | play+timecode | loop/easing/graph — Add a Shot stays at the end */}
      <div className="flex items-center gap-3 pb-1.5">
        <ComposeDockTabs />
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
          onClick={() => rig.setLoop(!loop)}
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
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <span className="hidden truncate text-[10px] text-ink-dim xl:block">
            {timelineGraph
              ? 'Scroll to zoom frames · drag diamonds and bezier handles on the graph'
              : timelineEasing
                ? 'Drag interval handles to retime · trajectory stays put'
                : 'Scroll to zoom frames · Shift+scroll pans · Alt+click a lane to add a key'}
          </span>
          <button
            onClick={() => void saveCurrentAsShot()}
            title="Snapshot this camera move as a shot in Sequence"
            className="shrink-0 rounded-md bg-panel-2 px-2.5 py-1 text-[11px] text-ink hover:bg-panel-3"
          >
            Add a Shot
          </button>
        </div>
      </div>

      {/* ruler + tracks share one aligned area */}
      <div className="flex items-stretch gap-2">
        <div className="w-24 shrink-0" />
        <div className="relative min-w-0 flex-1 overflow-hidden">
          {/* ruler — wheel zooms around the cursor; Shift+wheel pans */}
          <div
            ref={rulerRef}
            aria-label="Time ruler"
            title="Drag to scrub · scroll anywhere on the timeline to zoom frames · Shift+scroll to pan"
            className="relative h-7 cursor-col-resize select-none"
            onPointerDown={(e) => {
              scrubbing.current = true
              e.currentTarget.setPointerCapture(e.pointerId)
              scrub(e)
            }}
            onPointerMove={(e) => {
              if (scrubbing.current) scrub(e)
            }}
            onPointerUp={(e) => {
              scrubbing.current = false
              try {
                e.currentTarget.releasePointerCapture(e.pointerId)
              } catch {
                /* pointer may be gone */
              }
            }}
          >
            {ticks.map((mark, i) => (
              <div
                key={`${mark.t}-${i}`}
                className="absolute bottom-0 top-0"
                style={{ left: `${timeToX(mark.t, timelineView) * 100}%` }}
              >
                <div
                  className={`absolute bottom-0 w-px bg-line ${mark.major ? 'h-2.5' : 'h-1.5 opacity-70'}`}
                />
                {mark.label && (
                  <span className="absolute bottom-2.5 translate-x-0.5 text-[9px] tabular-nums text-ink-dim">
                    {mark.label}
                  </span>
                )}
              </div>
            ))}
            <div className="absolute bottom-0 left-0 right-0 h-px bg-line" />
          </div>
        </div>
        <div className="w-6 shrink-0" />
      </div>

      {/* tracks / graph */}
      <div className={`relative min-h-0 flex-1 ${timelineGraph ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {timelineGraph ? (
          <GraphEditor
            channels={buildGraphChannels({
              duration,
              progressKeys: progressLaneKeys(progressKeys, duration),
              progressPlot,
              intensityKeys,
              intensityPlot,
              fxParamBag,
              fxParamPlots,
              cameraNoiseEnabled: cameraNoise.enabled,
              fovKeys,
              rollKeys,
              targetKeys,
              lookOffsetKeys,
              channelPlots,
              tracking: Boolean(
                targetObjectId && objects.some((object) => object.id === targetObjectId),
              ),
            })}
            defaultEase={ease}
          />
        ) : (
        <div className="flex flex-col gap-1 pt-1">
          <Track
            label="Camera"
            trackId="progress"
            selectId="cinema-camera"
            color="#3b82f6"
            keys={progressLaneKeys(progressKeys, duration)}
            onMove={rig.updateProgressKeyTime}
            onDelete={(id) => {
              rig.removeProgressKey(id)
              useEditorStore.getState().selectKeyframe(null)
            }}
            onAdd={() => insertChannelKeyAt('progress', useRigStore.getState().t)}
            onAddAt={(time) => insertChannelKeyAt('progress', time)}
            addTitle="Pin the camera's path position at the playhead"
            curve={progressPlot.curve}
            valueRange={progressPlot.range}
            onMoveValue={(id, value) =>
              useRigStore.getState().setKeyValue('progress', id, clampChannelValue('progress', value))
            }
            onBezier={(id, bezier) => useRigStore.getState().setKeyBezier('progress', id, bezier)}
            onSpacing={applyProgressSpacing}
            selectedId={rigSelectedId(selectedKeyframe, 'progress')}
            onSelectKey={(id) => selectRigKey('progress', id)}
            defaultEase={ease}
          />
          {cameraNoise.enabled && (
            <Track
              label="FX"
              trackId="intensity"
              selectId="cinema-camera"
              color="#f59e0b"
              keys={intensityKeys.map((k) => ({
                id: k.id,
                time: k.time,
                title: `${(k.time * duration).toFixed(1)}s — Amount ${Math.round(k.value * 100)}%`,
                value: k.value,
                ease: k.ease,
                easeBezier: k.easeBezier,
                easeIn: k.easeIn,
                easeOut: k.easeOut,
              }))}
              onMove={(keyId, time) =>
                useRigStore.getState().updateChannelKeyTime('intensity', keyId, time)
              }
              onDelete={(keyId) => {
                useRigStore.getState().removeChannelKey('intensity', keyId)
                useEditorStore.getState().selectKeyframe(null)
              }}
              onAdd={() => insertChannelKeyAt('intensity', useRigStore.getState().t)}
              onAddAt={(time) => insertChannelKeyAt('intensity', time)}
              addTitle="Add an FX amount keyframe at the playhead"
              curve={intensityPlot.curve}
              valueRange={intensityPlot.range}
              onMoveValue={(id, value) =>
                useRigStore.getState().setKeyValue('intensity', id, clampChannelValue('unit', value))
              }
              onBezier={(id, bezier) => useRigStore.getState().setKeyBezier('intensity', id, bezier)}
              onSpacing={(id, side, w) => applyChannelSpacing('intensity', id, side, w)}
              selectedId={rigSelectedId(selectedKeyframe, 'intensity')}
              onSelectKey={(id) => selectRigKey('intensity', id)}
              defaultEase={ease}
              range={{
                start: cameraNoise.start,
                end: cameraNoise.end,
                fadeIn: cameraNoise.fadeIn,
                fadeOut: cameraNoise.fadeOut,
                duration,
                onChange: (start, end) =>
                  useRigStore.getState().setCameraNoise({ start, end }),
              }}
            />
          )}
          {cameraNoise.enabled &&
            FX_PARAM_CHANNELS.map((channel) => {
              const keys = fxParamBag[channel.id]
              const plot = fxParamPlots[channel.id]
              return (
                <Track
                  key={channel.id}
                  trackId={channel.id}
                  label={channel.label}
                  selectId="cinema-camera"
                  color="#f59e0b"
                  keys={keys.map((k) => ({
                    id: k.id,
                    time: k.time,
                    title: `${(k.time * duration).toFixed(1)}s — ${channel.label}`,
                    value: k.value,
                    ease: k.ease,
                    easeBezier: k.easeBezier,
                    easeIn: k.easeIn,
                    easeOut: k.easeOut,
                  }))}
                  onMove={(keyId, time) =>
                    useRigStore.getState().updateChannelKeyTime(channel.id, keyId, time)
                  }
                  onDelete={(keyId) => {
                    useRigStore.getState().removeChannelKey(channel.id, keyId)
                    useEditorStore.getState().selectKeyframe(null)
                  }}
                  curve={plot?.curve}
                  valueRange={plot?.range}
                  onMoveValue={(id, value) =>
                    useRigStore.getState().setKeyValue(channel.id, id, clampChannelValue('unit', value))
                  }
                  onBezier={(id, bezier) => useRigStore.getState().setKeyBezier(channel.id, id, bezier)}
                  onAdd={() => insertChannelKeyAt(channel.id, useRigStore.getState().t)}
                  onAddAt={(time) => insertChannelKeyAt(channel.id, time)}
                  addTitle={`Add a ${channel.label} keyframe at the playhead`}
                  onSpacing={(id, side, w) => applyChannelSpacing(channel.id, id, side, w)}
                  selectedId={rigSelectedId(selectedKeyframe, channel.id)}
                  onSelectKey={(id) => selectRigKey(channel.id, id)}
                  defaultEase={ease}
                />
              )
            })}
          {CAMERA_CHANNELS.map((channel) => {
            const tracking = Boolean(
              targetObjectId && objects.some((object) => object.id === targetObjectId),
            )
            if (tracking && channel.id === 'target') return null
            if (!tracking && channel.id === 'lookOffset') return null
            const keys = channel.pick({ fovKeys, rollKeys, targetKeys, lookOffsetKeys })
            const plot = channelPlots[channel.id]
            const valueOf = (id: string) => {
              if (channel.id === 'fov') return fovKeys.find((k) => k.id === id)?.value
              if (channel.id === 'roll') return rollKeys.find((k) => k.id === id)?.value
              if (channel.id === 'target') return targetKeys.find((k) => k.id === id)?.value[1]
              return lookOffsetKeys.find((k) => k.id === id)?.value[1]
            }
            return (
              <Track
                key={channel.id}
                trackId={channel.id}
                label={channel.label}
                selectId="cinema-camera"
                color="#60a5fa"
                keys={keys.map((k) => {
                  const full =
                    channel.id === 'fov'
                      ? fovKeys.find((item) => item.id === k.id)
                      : channel.id === 'roll'
                        ? rollKeys.find((item) => item.id === k.id)
                        : channel.id === 'target'
                          ? targetKeys.find((item) => item.id === k.id)
                          : lookOffsetKeys.find((item) => item.id === k.id)
                  return {
                    id: k.id,
                    time: k.time,
                    title: `${(k.time * duration).toFixed(1)}s — ${channel.label} ${channel.describe(k)}`,
                    value: valueOf(k.id),
                    ease: full?.ease,
                    easeBezier: full?.easeBezier,
                    easeIn: k.easeIn,
                    easeOut: k.easeOut,
                  }
                })}
                onMove={(keyId, time) =>
                  useRigStore.getState().updateChannelKeyTime(channel.id, keyId, time)
                }
                onDelete={(keyId) => {
                  useRigStore.getState().removeChannelKey(channel.id, keyId)
                  useEditorStore.getState().selectKeyframe(null)
                }}
                curve={plot.curve}
                valueRange={plot.range}
                onMoveValue={(id, value) => {
                  const clamped =
                    channel.id === 'fov'
                      ? clampChannelValue('fov', value)
                      : channel.id === 'roll'
                        ? clampChannelValue('roll', value)
                        : value
                  useRigStore.getState().setKeyValue(channel.id, id, clamped)
                }}
                onBezier={(id, bezier) => useRigStore.getState().setKeyBezier(channel.id, id, bezier)}
                onAdd={() => insertChannelKeyAt(channel.id, useRigStore.getState().t)}
                onAddAt={(time) => insertChannelKeyAt(channel.id, time)}
                addTitle={`Add a ${channel.label} keyframe at the playhead`}
                onSpacing={(id, side, w) => applyChannelSpacing(channel.id, id, side, w)}
                selectedId={rigSelectedId(selectedKeyframe, channel.id)}
                onSelectKey={(id) => selectRigKey(channel.id, id)}
                defaultEase={ease}
              />
            )
          })}
          {objects.map((object) => {
            const followName = object.follow
              ? object.follow.pathId === CAMERA_PATH_ID
                ? 'Camera Path'
                : (paths.find((p) => p.id === object.follow!.pathId)?.name ?? 'path')
              : undefined
            if (followName) {
              return (
                <Track
                  key={object.id}
                  trackId={`object-${object.id}`}
                  label={object.name}
                  selectId={`obj:${object.id}`}
                  color="#7c5cff"
                  note={`follows ${followName}`}
                  keys={[]}
                  onMove={() => {}}
                  onDelete={() => {}}
                  onAdd={() => {}}
                  addTitle=""
                  defaultEase={ease}
                />
              )
            }
            const channels = object.keys.length === 0 ? null : OBJECT_CHANNELS
            if (!channels) {
              return (
                <Track
                  key={object.id}
                  trackId={`object-${object.id}`}
                  label={object.name}
                  selectId={`obj:${object.id}`}
                  color="#7c5cff"
                  keys={[]}
                  onMove={() => {}}
                  onDelete={() => {}}
                  onAdd={() => scene.addObjectKey(object.id, useRigStore.getState().t)}
                  onAddAt={(time) => scene.addObjectKey(object.id, time)}
                  addTitle="Save the current pose at the playhead"
                  selectedId={
                    selectedKeyframe?.kind === 'object' && selectedKeyframe.objectId === object.id
                      ? selectedKeyframe.id
                      : null
                  }
                  onSelectKey={(id) =>
                    useEditorStore.getState().selectTimelineKey(
                      { kind: 'object', objectId: object.id, id },
                      `obj:${object.id}`,
                    )
                  }
                  defaultEase={ease}
                />
              )
            }
            return (
              <Fragment key={object.id}>
                {channels.map((channel) => {
              const laneKeys = keysForObjectChannel(object.keys, channel)
              const label = OBJECT_CHANNEL_LABELS[channel]
              return (
                <Track
                  key={`${object.id}-${channel}`}
                  trackId={`object-${object.id}-${channel}`}
                  label={`${object.name} · ${label}`}
                  selectId={`obj:${object.id}`}
                  color="#7c5cff"
                  keys={laneKeys.map((k) => ({
                    id: k.id,
                    time: k.time,
                    title: `${(k.time * duration).toFixed(1)}s — ${
                      objectKeyChannel(k) === 'pose' ? 'pose' : label
                    }`,
                    ease: k.ease,
                    easeBezier: k.easeBezier,
                    easeIn: k.easeIn,
                    easeOut: k.easeOut,
                  }))}
                  onMove={(keyId, time) => scene.updateObjectKeyTime(object.id, keyId, time)}
                  onDelete={(keyId) => {
                    scene.removeObjectKey(object.id, keyId, channel)
                    useEditorStore.getState().selectKeyframe(null)
                  }}
                  onAdd={() => scene.addObjectKey(object.id, useRigStore.getState().t, channel)}
                  onAddAt={(time) => scene.addObjectKey(object.id, time, channel)}
                  addTitle={`Add a ${label.toLowerCase()} keyframe at the playhead`}
                  curve={objectChannelCurve(object.keys, channel, object.transform, ease)}
                  onBezier={(id, bezier) =>
                    useSceneStore.getState().setObjectKeyBezier(object.id, id, bezier)
                  }
                  onSpacing={(id, side, w) =>
                    useSceneStore.getState().setObjectKeySpacing(
                      object.id,
                      id,
                      side === 'out' ? { easeOut: w } : { easeIn: w },
                      useEditorStore.getState().easingLinked,
                    )
                  }
                  selectedId={
                    selectedKeyframe?.kind === 'object' && selectedKeyframe.objectId === object.id
                      ? selectedKeyframe.id
                      : null
                  }
                  onSelectKey={(id) =>
                    useEditorStore.getState().selectTimelineKey(
                      { kind: 'object', objectId: object.id, id },
                      `obj:${object.id}`,
                    )
                  }
                  defaultEase={ease}
                />
              )
                })}
              </Fragment>
            )
          })}
        </div>
        )}

        {/* playhead spanning the tracks area, aligned with the ruler lane */}
        {timeInView(t, timelineView) && (
          <div
            className="pointer-events-none absolute bottom-0 top-[-28px]"
            style={{
              left: `calc(6.5rem + (100% - 6.5rem - 2rem) * ${playX})`,
            }}
          >
            <div className="absolute bottom-0 top-0 w-px bg-accent" />
            <div className="absolute -top-0.5 -translate-x-1/2 rounded bg-accent px-1 py-px text-[9px] font-medium tabular-nums text-white">
              {formatTimecode(t, duration)}
            </div>
          </div>
        )}
      </div>
      <TimeNavigator
        view={timelineView}
        onChange={(view) => useEditorStore.getState().setTimelineView(view)}
      />
    </div>
    </TimeViewCtx.Provider>
  )
}
