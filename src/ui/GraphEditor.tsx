import { type PointerEvent as ReactPointerEvent } from 'react'
import {
  clampChannelValue,
  formatGraphValue,
  graphValueTicks,
  RANGE_UNIT,
  valueFromLanePointer,
  valueToGraphY,
  type GraphValueFormat,
  type ValueRange,
} from '../lib/lanePlot'
import { KEY_MERGE_EPS, keyOutgoingBezier, type ValueKey, type Vec3Key } from '../lib/keyframes'
import { insertChannelKeyAt } from '../lib/timelineKey'
import { snapToFrame, timeToX, xToTime, type TimeView } from '../lib/timeView'
import type { EaseKind } from '../lib/easing'
import {
  cubicSegmentPath,
  cssBezierHandles,
  pointerToCssBezier,
  rangeWithHandles,
} from '../lib/graphSpline'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore, type RigChannel } from '../state/useRigStore'
import { CAMERA_CHANNELS, FX_PARAM_CHANNELS } from './cameraChannels'

export type GraphLaneKey = {
  id: string
  time: number
  title: string
  value?: number
  ease?: EaseKind
  easeBezier?: [number, number, number, number]
  implicit?: boolean
}

export type GraphChannel = {
  id: RigChannel
  label: string
  color: string
  keys: GraphLaneKey[]
  curve: number[]
  range: ValueRange
  format: GraphValueFormat
}

function timeFromEvent(e: { clientX: number }, lane: HTMLElement, view: TimeView) {
  const rect = lane.getBoundingClientRect()
  const x = (e.clientX - rect.left) / Math.max(1e-6, rect.width)
  return xToTime(x, view)
}

function materializeProgressId(id: string): string {
  if (id !== 'implicit-start' && id !== 'implicit-end') return id
  const rig = useRigStore.getState()
  if (id === 'implicit-start') {
    rig.upsertProgressKey(0, 0)
    return useRigStore.getState().progressKeys.find((k) => Math.abs(k.time) < KEY_MERGE_EPS)?.id ?? id
  }
  rig.upsertProgressKey(1, 1)
  return (
    useRigStore.getState().progressKeys.find((k) => Math.abs(k.time - 1) < KEY_MERGE_EPS)?.id ?? id
  )
}

function writeBezier(channel: RigChannel, id: string, bezier: [number, number, number, number]) {
  const keyId = channel === 'progress' ? materializeProgressId(id) : id
  useRigStore.getState().setKeyBezier(channel, keyId, bezier)
}

function clampWrite(channel: RigChannel, value: number): number {
  switch (channel) {
    case 'progress':
      return clampChannelValue('progress', value)
    case 'fov':
      return clampChannelValue('fov', value)
    case 'roll':
      return clampChannelValue('roll', value)
    case 'intensity':
    case 'fadeIn':
    case 'fadeOut':
    case 'ampPos':
    case 'ampRot':
    case 'freq':
      return clampChannelValue('unit', value)
    case 'target':
    case 'lookOffset':
      return value
    default: {
      const _never: never = channel
      return _never
    }
  }
}

function GraphTangent({
  which,
  t0,
  t1,
  v0,
  v1,
  bezier,
  range,
  color,
  onChange,
}: {
  which: 1 | 2
  t0: number
  t1: number
  v0: number
  v1: number
  bezier: [number, number, number, number]
  range: ValueRange
  color: string
  onChange: (bezier: [number, number, number, number]) => void
}) {
  const view = useEditorStore((s) => s.timelineView)
  if (t1 - t0 < 1e-4 || Math.abs(v1 - v0) < 1e-6) return null
  const [h1, h2] = cssBezierHandles(t0, t1, v0, v1, bezier)
  const handle = which === 1 ? h1 : h2

  return (
    <button
      type="button"
      data-bezier-handle={which}
      title="Drag to edit the spline · Shift for finer control"
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const lane = e.currentTarget.parentElement
        if (!lane) return
        const origin = { x: e.clientX, y: e.clientY, bezier }
        let dragging = false
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - origin.x
          const dy = ev.clientY - origin.y
          if (!dragging && dx * dx + dy * dy < 9) return
          dragging = true
          const scale = ev.shiftKey ? 0.1 : 1
          const pointer = {
            clientX: origin.x + (ev.clientX - origin.x) * scale,
            clientY: origin.y + (ev.clientY - origin.y) * scale,
          }
          const liveView = useEditorStore.getState().timelineView
          const time = timeFromEvent(pointer, lane, liveView)
          const value = valueFromLanePointer(pointer.clientY, lane, range)
          onChange(pointerToCssBezier(which, time, value, t0, t1, v0, v1, origin.bezier))
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      className="absolute z-[11] flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-move items-center justify-center"
      style={{
        left: `${timeToX(handle.t, view) * 100}%`,
        top: `${valueToGraphY(handle.v, range)}%`,
      }}
    >
      <span
        className="block h-2.5 w-2.5 rounded-full border border-white/80 shadow-sm"
        style={{ backgroundColor: color }}
      />
    </button>
  )
}

function GraphKey({
  id,
  time,
  color,
  title,
  selected,
  implicit,
  topPct,
  duration,
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
  implicit?: boolean
  topPct: number
  duration: number
  onMove: (id: string, time: number) => void
  onMoveValue: (id: string, value: number) => void
  onDelete: (id: string) => void
  onSelect: (id: string) => string
}) {
  const view = useEditorStore((s) => s.timelineView)

  return (
    <button
      type="button"
      data-timeline-key={id}
      data-selected-key={selected ? 'true' : undefined}
      data-implicit-key={implicit ? 'true' : undefined}
      title={
        implicit
          ? `${title} — click to edit · drag to move`
          : `${title} — drag to move (snaps to frames, Shift for fine) · Delete to remove`
      }
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (!implicit) onDelete(id)
      }}
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const lane = e.currentTarget.parentElement
        if (!lane) return
        const liveId = onSelect(id)
        const origin = { x: e.clientX, y: e.clientY }
        let dragging = false
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - origin.x
          const dy = ev.clientY - origin.y
          if (!dragging && dx * dx + dy * dy < 9) return
          dragging = true
          const scale = ev.shiftKey ? 0.1 : 1
          const pointer = {
            clientX: origin.x + (ev.clientX - origin.x) * scale,
            clientY: origin.y + (ev.clientY - origin.y) * scale,
          }
          const liveView = useEditorStore.getState().timelineView
          let nextTime = timeFromEvent(pointer, lane, liveView)
          if (!ev.shiftKey) nextTime = snapToFrame(nextTime, duration)
          onMove(liveId, nextTime)
          onMoveValue(liveId, valueFromLanePointer(pointer.clientY, lane, onMoveValueRange(lane)))
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      className={`absolute z-10 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center ${
        implicit ? 'cursor-pointer' : 'cursor-move'
      }`}
      style={{
        left: `${timeToX(time, view) * 100}%`,
        top: `${topPct}%`,
      }}
    >
      <span
        data-key-diamond
        className={`block h-3 w-3 rotate-45 rounded-[2px] border ${
          implicit
            ? 'border-white/50 bg-transparent'
            : `border-black/30 ${selected ? 'ring-2 ring-white ring-offset-0' : ''}`
        }`}
        style={{ backgroundColor: implicit ? 'transparent' : color }}
      />
    </button>
  )
}

function onMoveValueRange(lane: HTMLElement): ValueRange {
  const lo = Number(lane.dataset.rangeLo)
  const hi = Number(lane.dataset.rangeHi)
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-9) {
    return { lo: 0, hi: 1 }
  }
  return { lo, hi }
}

export function GraphEditor({
  channels,
  defaultEase,
}: {
  channels: GraphChannel[]
  defaultEase: EaseKind
}) {
  const view = useEditorStore((s) => s.timelineView)
  const graphChannel = useEditorStore((s) => s.graphChannel)
  const selectedKeyframe = useEditorStore((s) => s.selectedKeyframe)
  const duration = useRigStore((s) => s.duration)
  const focused = channels.find((channel) => channel.id === graphChannel) ?? channels[0]
  if (!focused) return null

  const sorted = [...focused.keys].sort((a, b) => a.time - b.time)
  const range = rangeWithHandles(focused.range, sorted, defaultEase)
  const selectedId =
    selectedKeyframe?.kind === 'rig' && selectedKeyframe.channel === focused.id
      ? selectedKeyframe.id
      : null
  const ticks = graphValueTicks(range, 5)
  const minorTicks = graphValueTicks(range, 9)
  const tangents = tangentsForSelected(sorted, selectedId)

  const hitOnHandle = (target: EventTarget | null) =>
    target instanceof Element &&
    Boolean(target.closest('[data-timeline-key],[data-bezier-handle]'))

  const addAt = (time: number) => insertChannelKeyAt(focused.id, snapToFrame(time, duration))

  const selectKey = (id: string) => {
    const realId = focused.id === 'progress' ? materializeProgressId(id) : id
    useEditorStore.getState().selectTimelineKey(
      { kind: 'rig', channel: focused.id, id: realId },
      'cinema-camera',
    )
    return realId
  }

  return (
    <div className="flex h-full min-h-0 items-stretch gap-2 pt-1" data-graph-editor>
      <div className="flex w-24 shrink-0 flex-col gap-0.5 overflow-y-auto">
        {channels.map((channel) => {
          const on = channel.id === focused.id
          return (
            <button
              key={channel.id}
              type="button"
              data-graph-channel={channel.id}
              onClick={() => {
                useEditorStore.getState().setGraphChannel(channel.id)
                useEditorStore.getState().select('cinema-camera')
              }}
              className={`truncate rounded-md px-2 py-1 text-left text-[11px] ${
                on ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
              }`}
            >
              {channel.label}
            </button>
          )
        })}
      </div>
      <div
        data-graph-lane
        data-lane
        data-range-lo={range.lo}
        data-range-hi={range.hi}
        className="relative h-full min-w-0 flex-1 cursor-crosshair overflow-hidden rounded-md bg-panel-2/50"
        title="Click to move playhead · Alt+click to add a key · drag diamonds and handles · Shift for fine control"
        onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
          if (hitOnHandle(e.target)) return
          const time = snapToFrame(timeFromEvent(e, e.currentTarget, view), duration)
          useRigStore.getState().setPlaying(false)
          useRigStore.getState().setT(time)
          useEditorStore.getState().selectKeyframe(null)
          if (e.altKey) {
            e.preventDefault()
            addAt(time)
          }
        }}
        onDoubleClick={(e) => {
          if (hitOnHandle(e.target)) return
          addAt(timeFromEvent(e, e.currentTarget, view))
        }}
      >
        <div data-graph-value-axis className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-12">
          {ticks.map((value, i) => (
            <span
              key={`${value}-${i}`}
              className="absolute left-1 -translate-y-1/2 text-[9px] tabular-nums text-ink-dim"
              style={{ top: `${valueToGraphY(value, range)}%` }}
            >
              {formatGraphValue(focused.format, value)}
            </span>
          ))}
        </div>
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`${view.start * 100} 0 ${view.span * 100} 100`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {minorTicks.map((value, i) => (
            <line
              key={`minor-${value}-${i}`}
              x1={view.start * 100}
              x2={(view.start + view.span) * 100}
              y1={valueToGraphY(value, range)}
              y2={valueToGraphY(value, range)}
              stroke="currentColor"
              className="text-line"
              strokeOpacity={0.28}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {ticks.map((value, i) => (
            <line
              key={`grid-${value}-${i}`}
              x1={view.start * 100}
              x2={(view.start + view.span) * 100}
              y1={valueToGraphY(value, range)}
              y2={valueToGraphY(value, range)}
              stroke="currentColor"
              className="text-line"
              strokeOpacity={0.55}
              strokeWidth={0.7}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {sorted.slice(0, -1).map((left, i) => {
            const right = sorted[i + 1]
            if (left.value === undefined || right.value === undefined) return null
            const bezier = keyOutgoingBezier(left, defaultEase)
            const selected = left.id === selectedId || right.id === selectedId
            return (
              <path
                key={`${left.id}-${right.id}`}
                data-graph-spline={left.id}
                d={cubicSegmentPath(left.time, right.time, left.value, right.value, bezier, range)}
                fill="none"
                stroke={focused.color}
                strokeWidth={selected ? 2.6 : 2.2}
                strokeOpacity={0.95}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
          {tangents.map((item) => {
            if (item.left.value === undefined || item.right.value === undefined) return null
            const bezier = keyOutgoingBezier(item.left, defaultEase)
            const [h1, h2] = cssBezierHandles(
              item.left.time,
              item.right.time,
              item.left.value,
              item.right.value,
              bezier,
            )
            const handle = item.which === 1 ? h1 : h2
            const from =
              item.which === 1
                ? { t: item.left.time, v: item.left.value }
                : { t: item.right.time, v: item.right.value }
            return (
              <line
                key={`tan-${item.left.id}-${item.which}`}
                x1={from.t * 100}
                y1={valueToGraphY(from.v, range)}
                x2={handle.t * 100}
                y2={valueToGraphY(handle.v, range)}
                stroke={focused.color}
                strokeOpacity={0.9}
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
        </svg>
        {sorted.map((key) =>
          key.value === undefined ? null : (
            <GraphKey
              key={key.id}
              id={key.id}
              time={key.time}
              color={focused.color}
              title={key.title}
              selected={key.id === selectedId}
              implicit={key.implicit}
              topPct={valueToGraphY(key.value, range)}
              duration={duration}
              onMove={(id, time) =>
                useRigStore.getState().updateChannelKeyTime(focused.id, id, time)
              }
              onMoveValue={(id, value) =>
                useRigStore.getState().setKeyValue(focused.id, id, clampWrite(focused.id, value))
              }
              onDelete={(id) => {
                useRigStore.getState().removeChannelKey(focused.id, id)
                useEditorStore.getState().selectKeyframe(null)
              }}
              onSelect={selectKey}
            />
          ),
        )}
        {tangents.map((item) => {
          if (item.left.value === undefined || item.right.value === undefined) return null
          return (
            <GraphTangent
              key={`handle-${item.left.id}-${item.which}`}
              which={item.which}
              t0={item.left.time}
              t1={item.right.time}
              v0={item.left.value}
              v1={item.right.value}
              bezier={keyOutgoingBezier(item.left, defaultEase)}
              range={range}
              color={focused.color}
              onChange={(bezier) => writeBezier(focused.id, item.left.id, bezier)}
            />
          )
        })}
      </div>
      {selectedId ? (
        <button
          data-delete-key
          type="button"
          onClick={() => {
            useRigStore.getState().removeChannelKey(focused.id, selectedId)
            useEditorStore.getState().selectKeyframe(null)
          }}
          title="Delete selected keyframe (Delete)"
          className="w-6 shrink-0 self-start rounded-md py-1 text-[13px] leading-none text-ink-dim hover:bg-panel-2 hover:text-ink"
        >
          ×
        </button>
      ) : (
        <button
          data-add-key
          type="button"
          onClick={() => addAt(useRigStore.getState().t)}
          title={`Add a ${focused.label} keyframe at the playhead`}
          className="w-6 shrink-0 self-start rounded-md py-1 text-[13px] leading-none text-ink-dim hover:bg-panel-2 hover:text-ink"
        >
          +
        </button>
      )}
    </div>
  )
}

function tangentsForSelected(
  sorted: GraphLaneKey[],
  selectedId: string | null,
): { left: GraphLaneKey; right: GraphLaneKey; which: 1 | 2 }[] {
  if (!selectedId) return []
  const index = sorted.findIndex((key) => key.id === selectedId)
  if (index < 0) return []
  const out: { left: GraphLaneKey; right: GraphLaneKey; which: 1 | 2 }[] = []
  if (index > 0) out.push({ left: sorted[index - 1], right: sorted[index], which: 2 })
  if (index < sorted.length - 1) {
    out.push({ left: sorted[index], right: sorted[index + 1], which: 1 })
  }
  return out
}

type ScalarPlot = { curve: number[]; range: ValueRange }

export function buildGraphChannels(input: {
  duration: number
  progressKeys: GraphLaneKey[]
  progressPlot: ScalarPlot
  intensityKeys: ValueKey[]
  intensityPlot: ScalarPlot
  fxParamBag: Record<(typeof FX_PARAM_CHANNELS)[number]['id'], ValueKey[]>
  fxParamPlots: Partial<Record<(typeof FX_PARAM_CHANNELS)[number]['id'], ScalarPlot>>
  cameraNoiseEnabled: boolean
  fovKeys: ValueKey[]
  rollKeys: ValueKey[]
  targetKeys: Vec3Key[]
  lookOffsetKeys: Vec3Key[]
  channelPlots: Record<'fov' | 'roll' | 'target' | 'lookOffset', ScalarPlot>
  tracking: boolean
}): GraphChannel[] {
  const duration = input.duration
  const channels: GraphChannel[] = [
    {
      id: 'progress',
      label: 'Camera',
      color: '#3b82f6',
      keys: input.progressKeys,
      curve: input.progressPlot.curve,
      range: input.progressPlot.range,
      format: 'percent',
    },
  ]
  if (input.cameraNoiseEnabled) {
    channels.push({
      id: 'intensity',
      label: 'FX',
      color: '#f59e0b',
      keys: input.intensityKeys.map((k) => ({
        id: k.id,
        time: k.time,
        title: `${(k.time * duration).toFixed(1)}s — Amount ${Math.round(k.value * 100)}%`,
        value: k.value,
        ease: k.ease,
        easeBezier: k.easeBezier,
      })),
      curve: input.intensityPlot.curve,
      range: input.intensityPlot.range,
      format: 'unit',
    })
    for (const channel of FX_PARAM_CHANNELS) {
      const keys = input.fxParamBag[channel.id]
      const plot = input.fxParamPlots[channel.id]
      channels.push({
        id: channel.id,
        label: channel.label,
        color: '#f59e0b',
        keys: keys.map((k) => ({
          id: k.id,
          time: k.time,
          title: `${(k.time * duration).toFixed(1)}s — ${channel.label}`,
          value: k.value,
          ease: k.ease,
          easeBezier: k.easeBezier,
        })),
        curve: plot?.curve ?? [],
        range: plot?.range ?? RANGE_UNIT,
        format: 'unit',
      })
    }
  }
  for (const channel of CAMERA_CHANNELS) {
    if (input.tracking && channel.id === 'target') continue
    if (!input.tracking && channel.id === 'lookOffset') continue
    const keys = channel.pick({
      fovKeys: input.fovKeys,
      rollKeys: input.rollKeys,
      targetKeys: input.targetKeys,
      lookOffsetKeys: input.lookOffsetKeys,
    })
    const plot = input.channelPlots[channel.id]
    const valueOf = (id: string) => {
      switch (channel.id) {
        case 'fov':
          return input.fovKeys.find((k) => k.id === id)?.value
        case 'roll':
          return input.rollKeys.find((k) => k.id === id)?.value
        case 'target':
          return input.targetKeys.find((k) => k.id === id)?.value[1]
        case 'lookOffset':
          return input.lookOffsetKeys.find((k) => k.id === id)?.value[1]
        default: {
          const _never: never = channel.id
          return _never
        }
      }
    }
    const format: GraphValueFormat = channel.id === 'fov' || channel.id === 'roll' ? 'degrees' : 'look'
    channels.push({
      id: channel.id,
      label: channel.label,
      color: '#60a5fa',
      keys: keys.map((k) => {
        let full: ValueKey | Vec3Key | undefined
        switch (channel.id) {
          case 'fov':
            full = input.fovKeys.find((item) => item.id === k.id)
            break
          case 'roll':
            full = input.rollKeys.find((item) => item.id === k.id)
            break
          case 'target':
            full = input.targetKeys.find((item) => item.id === k.id)
            break
          case 'lookOffset':
            full = input.lookOffsetKeys.find((item) => item.id === k.id)
            break
          default: {
            const _never: never = channel.id
            return _never
          }
        }
        return {
          id: k.id,
          time: k.time,
          title: `${(k.time * duration).toFixed(1)}s — ${channel.label} ${channel.describe(k)}`,
          value: valueOf(k.id),
          ease: full?.ease,
          easeBezier: full?.easeBezier,
        }
      }),
      curve: plot.curve,
      range: plot.range,
      format,
    })
  }
  return channels
}

