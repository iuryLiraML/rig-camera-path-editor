import {
  Fragment,
  useContext,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useEditorStore, type SelectableId, type SelectedTimelineKey } from '../../state/useEditorStore'
import {
  DEFAULT_SPACING,
  inHandleU,
  outHandleU,
  uToInW,
  uToOutW,
} from '../../lib/intervalSpacing'
import { useRigStore, type RigChannel } from '../../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore } from '../../state/usePathStore'
import { useSceneStore, type Transform } from '../../state/useSceneStore'
import {
  evalModelTransform,
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
} from '../../lib/keyframes'
import { type EaseKind } from '../../lib/easing'
import {
  clampChannelValue,
  RANGE_UNIT,
  valueFromLanePointer,
  valueToLaneY,
  type ValueRange,
} from '../../lib/lanePlot'
import { insertChannelKeyAt } from '../../lib/timelineKey'
import { writeFov, writeObjectTransform, writeRoll, writeStaticPose } from '../../lib/autoKey'
import { timeToX } from '../../lib/timeView'
import { CAMERA_CHANNELS, FX_PARAM_CHANNELS } from '../cameraChannels'
import { Slider, XYZInput } from '../primitives'
import { normalizeSamples, sampleOverTime, TrackCurve } from '../TrackCurve'
import type { KeyableFocus } from '../../lib/keyAtPlayhead'
import { TimeViewCtx, timeFromEvent } from './timelineShared'

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

function TrackValues({ children }: { children: ReactNode }) {
  return <div className="mt-0.5">{children}</div>
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
  focus,
  values,
  onFocus,
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
  focus?: KeyableFocus
  values?: ReactNode
  onFocus?: () => void
}) {
  const selection = useEditorStore((s) => s.selection)
  const keyableFocus = useEditorStore((s) => s.keyableFocus)
  const easingOn = useEditorStore((s) => s.timelineEasing)
  const highlighted = focus ? keyableFocus === focus : selection === selectId
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
    <div className={`flex items-center gap-2 ${values ? 'h-14' : 'h-10'}`} data-track={trackId}>
      <div
        className={`w-44 shrink-0 rounded-md px-2 py-1 text-left text-[11px] ${
          highlighted ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
        }`}
      >
        <button
          type="button"
          className="block w-full truncate text-left"
          onClick={() => {
            useEditorStore.getState().select(selectId)
            onFocus?.()
          }}
        >
          {label}
        </button>
        {values && <TrackValues>{values}</TrackValues>}
      </div>
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
export function progressLaneKeys(keys: ProgressKey[], duration: number) {
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

export function TimelineTracks(props: {
  cameraKind: 'path' | 'static'
  t: number
  duration: number
  ease: EaseKind
  progressKeys: ProgressKey[]
  fovKeys: ReturnType<typeof useRigStore.getState>['fovKeys']
  rollKeys: ReturnType<typeof useRigStore.getState>['rollKeys']
  intensityKeys: ReturnType<typeof useRigStore.getState>['intensityKeys']
  targetKeys: ReturnType<typeof useRigStore.getState>['targetKeys']
  lookOffsetKeys: ReturnType<typeof useRigStore.getState>['lookOffsetKeys']
  staticPosKeys: ReturnType<typeof useRigStore.getState>['staticPosKeys']
  staticRotKeys: ReturnType<typeof useRigStore.getState>['staticRotKeys']
  staticPose: ReturnType<typeof useRigStore.getState>['staticPose']
  fov: number
  roll: number
  targetObjectId: string | null
  cameraNoise: ReturnType<typeof useRigStore.getState>['cameraNoise']
  objects: ReturnType<typeof useSceneStore.getState>['objects']
  paths: ReturnType<typeof usePathStore.getState>['paths']
  selectedKeyframe: SelectedTimelineKey | null
  progressPlot: { curve: number[]; range: ValueRange }
  fovPlot: { curve: number[]; range: ValueRange }
  rollPlot: { curve: number[]; range: ValueRange }
  targetPlot: { curve: number[]; range: ValueRange }
  lookOffsetPlot: { curve: number[]; range: ValueRange }
  staticPosPlot: { curve: number[]; range: ValueRange }
  staticRotPlot: { curve: number[]; range: ValueRange }
  intensityPlot: { curve: number[]; range: ValueRange }
  fxParamBag: {
    fadeIn: ReturnType<typeof useRigStore.getState>['fadeInKeys']
    fadeOut: ReturnType<typeof useRigStore.getState>['fadeOutKeys']
    ampPos: ReturnType<typeof useRigStore.getState>['ampPosKeys']
    ampRot: ReturnType<typeof useRigStore.getState>['ampRotKeys']
    freq: ReturnType<typeof useRigStore.getState>['freqKeys']
  }
  fxParamPlots: Partial<Record<'fadeIn' | 'fadeOut' | 'ampPos' | 'ampRot' | 'freq', { curve: number[]; range: ValueRange }>>
}) {
  const {
    cameraKind,
    t,
    duration,
    ease,
    progressKeys,
    fovKeys,
    rollKeys,
    intensityKeys,
    targetKeys,
    lookOffsetKeys,
    staticPosKeys,
    staticRotKeys,
    staticPose,
    fov,
    roll,
    targetObjectId,
    cameraNoise,
    objects,
    paths,
    selectedKeyframe,
    progressPlot,
    fovPlot,
    rollPlot,
    targetPlot,
    lookOffsetPlot,
    staticPosPlot,
    staticRotPlot,
    intensityPlot,
    fxParamBag,
    fxParamPlots,
  } = props
  const rig = useRigStore.getState()
  const scene = useSceneStore.getState()
  const channelPlots = {
    fov: fovPlot,
    roll: rollPlot,
    target: targetPlot,
    lookOffset: lookOffsetPlot,
  }
  return (
        <div className="flex flex-col gap-1 pt-1">
          {cameraKind !== 'static' && (
          <Track
            label="Camera"
            trackId="progress"
            selectId="cinema-camera"
            color="#3b82f6"
            focus="progress"
            onFocus={() => useEditorStore.getState().setKeyableFocus('progress')}
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
          )}
          {cameraKind === 'static' && staticPosKeys.length > 0 && (
            <Track
              label="Camera · Position"
              trackId="staticPos"
              selectId="cinema-camera"
              color="#60a5fa"
              focus="staticPos"
              onFocus={() => useEditorStore.getState().setKeyableFocus('staticPos')}
              values={
                <XYZInput
                  value={evalVec3(t, staticPosKeys, staticPose.position, ease)}
                  onChange={(axis, value) => {
                    const next = [...evalVec3(t, staticPosKeys, staticPose.position, ease)] as [
                      number,
                      number,
                      number,
                    ]
                    next[axis] = value
                    writeStaticPose({ position: next })
                  }}
                />
              }
              keys={staticPosKeys.map((k) => ({
                id: k.id,
                time: k.time,
                title: `${(k.time * duration).toFixed(1)}s — Position`,
                value: k.value[1],
                ease: k.ease,
                easeBezier: k.easeBezier,
                easeIn: k.easeIn,
                easeOut: k.easeOut,
              }))}
              onMove={(keyId, time) =>
                useRigStore.getState().updateChannelKeyTime('staticPos', keyId, time)
              }
              onDelete={(keyId) => {
                useRigStore.getState().removeChannelKey('staticPos', keyId)
                useEditorStore.getState().selectKeyframe(null)
              }}
              curve={staticPosPlot.curve}
              valueRange={staticPosPlot.range}
              onMoveValue={(id, value) => useRigStore.getState().setKeyValue('staticPos', id, value)}
              onBezier={(id, bezier) => useRigStore.getState().setKeyBezier('staticPos', id, bezier)}
              onAdd={() => insertChannelKeyAt('staticPos', useRigStore.getState().t)}
              onAddAt={(time) => insertChannelKeyAt('staticPos', time)}
              addTitle="Add a camera position keyframe at the playhead"
              onSpacing={(id, side, w) => applyChannelSpacing('staticPos', id, side, w)}
              selectedId={rigSelectedId(selectedKeyframe, 'staticPos')}
              onSelectKey={(id) => selectRigKey('staticPos', id)}
              defaultEase={ease}
            />
          )}
          {cameraKind === 'static' && staticRotKeys.length > 0 && (
            <Track
              label="Camera · Rotation"
              trackId="staticRot"
              selectId="cinema-camera"
              color="#60a5fa"
              focus="staticRot"
              onFocus={() => useEditorStore.getState().setKeyableFocus('staticRot')}
              values={
                <XYZInput
                  step={1}
                  value={evalVec3(t, staticRotKeys, staticPose.rotation, ease)}
                  onChange={(axis, value) => {
                    const next = [...evalVec3(t, staticRotKeys, staticPose.rotation, ease)] as [
                      number,
                      number,
                      number,
                    ]
                    next[axis] = value
                    writeStaticPose({ rotation: next })
                  }}
                />
              }
              keys={staticRotKeys.map((k) => ({
                id: k.id,
                time: k.time,
                title: `${(k.time * duration).toFixed(1)}s — Rotation`,
                value: k.value[1],
                ease: k.ease,
                easeBezier: k.easeBezier,
                easeIn: k.easeIn,
                easeOut: k.easeOut,
              }))}
              onMove={(keyId, time) =>
                useRigStore.getState().updateChannelKeyTime('staticRot', keyId, time)
              }
              onDelete={(keyId) => {
                useRigStore.getState().removeChannelKey('staticRot', keyId)
                useEditorStore.getState().selectKeyframe(null)
              }}
              curve={staticRotPlot.curve}
              valueRange={staticRotPlot.range}
              onMoveValue={(id, value) => useRigStore.getState().setKeyValue('staticRot', id, value)}
              onBezier={(id, bezier) => useRigStore.getState().setKeyBezier('staticRot', id, bezier)}
              onAdd={() => insertChannelKeyAt('staticRot', useRigStore.getState().t)}
              onAddAt={(time) => insertChannelKeyAt('staticRot', time)}
              addTitle="Add a camera rotation keyframe at the playhead"
              onSpacing={(id, side, w) => applyChannelSpacing('staticRot', id, side, w)}
              selectedId={rigSelectedId(selectedKeyframe, 'staticRot')}
              onSelectKey={(id) => selectRigKey('staticRot', id)}
              defaultEase={ease}
            />
          )}
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
                focus={channel.id}
                onFocus={() => useEditorStore.getState().setKeyableFocus(channel.id)}
                values={
                  channel.id === 'fov' ? (
                    <Slider
                      value={evalValue(t, fovKeys, fov, ease)}
                      min={15}
                      max={120}
                      step={1}
                      format={(v) => `${Math.round(v)}°`}
                      onChange={(v) => writeFov(v)}
                    />
                  ) : channel.id === 'roll' ? (
                    <Slider
                      value={evalValue(t, rollKeys, roll, ease)}
                      min={-180}
                      max={180}
                      step={1}
                      format={(v) => `${Math.round(v)}°`}
                      onChange={(v) => writeRoll(v)}
                    />
                  ) : undefined
                }
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
            const channels = OBJECT_CHANNELS.filter(
              (channel) => keysForObjectChannel(object.keys, channel).length > 0,
            )
            if (channels.length === 0) return null
            return (
              <Fragment key={object.id}>
                {channels.map((channel) => {
              const laneKeys = keysForObjectChannel(object.keys, channel)
              const label = OBJECT_CHANNEL_LABELS[channel]
              const live = evalModelTransform(t, object.keys, ease, object.transform) ?? object.transform
              const focus =
                channel === 'position'
                  ? 'objectPosition'
                  : channel === 'rotation'
                    ? 'objectRotation'
                    : 'objectScale'
              return (
                <Track
                  key={`${object.id}-${channel}`}
                  trackId={`object-${object.id}-${channel}`}
                  label={`${object.name} · ${label}`}
                  selectId={`obj:${object.id}`}
                  color="#7c5cff"
                  focus={focus}
                  onFocus={() => useEditorStore.getState().setKeyableFocus(focus)}
                  values={
                    <XYZInput
                      step={channel === 'rotation' ? 1 : 0.1}
                      value={live[channel]}
                      onChange={(axis, value) => {
                        const next = { ...live, [channel]: [...live[channel]] as typeof live.position }
                        next[channel][axis] = value
                        writeObjectTransform(object.id, next, [channel])
                      }}
                    />
                  }
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
          {objects.every((object) => object.follow || object.keys.length === 0) &&
            staticPosKeys.length === 0 &&
            staticRotKeys.length === 0 && (
              <p className="px-2 py-3 text-[11px] text-ink-dim">Select an object, then + Animate</p>
            )}
        </div>
  )
}
