import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useEditorStore, type SelectableId } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore, selectCameraAnchorCount } from '../state/usePathStore'
import { useSceneStore } from '../state/useSceneStore'
import { evalProgress } from '../lib/keyframes'
import { saveCurrentAsShot } from '../lib/projects'
import { PlayIcon } from './icons'

/** height of the docked timeline, used by other floating UI to move out of the way */
export const TIMELINE_HEIGHT = 168

const PauseIcon = () => (
  <svg width={12} height={12} viewBox="0 0 16 16" fill="currentColor">
    <rect x="3.5" y="3" width="3.2" height="10" rx="1" />
    <rect x="9.3" y="3" width="3.2" height="10" rx="1" />
  </svg>
)

/** seconds → x% and back, shared by ruler/tracks so everything lines up */
function timeFromEvent(e: { clientX: number }, lane: HTMLElement) {
  const rect = lane.getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
}

function Keyframe({
  id,
  time,
  color,
  title,
  onMove,
  onDelete,
}: {
  id: string
  time: number
  color: string
  title: string
  onMove: (id: string, time: number) => void
  onDelete: (id: string) => void
}) {
  const dragging = useRef(false)

  return (
    <button
      title={`${title} — drag to move, double-click to delete`}
      onDoubleClick={() => onDelete(id)}
      onPointerDown={(e) => {
        e.stopPropagation()
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const lane = e.currentTarget.parentElement
        if (lane) onMove(id, timeFromEvent(e, lane))
      }}
      onPointerUp={(e) => {
        dragging.current = false
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          /* pointer may be gone */
        }
      }}
      className="absolute top-1/2 z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize rounded-[2px] border border-black/30 hover:scale-125"
      style={{ left: `${time * 100}%`, backgroundColor: color }}
    />
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
  addTitle,
  note,
}: {
  label: string
  selectId: SelectableId
  color: string
  keys: { id: string; time: number; title: string }[]
  onMove: (id: string, time: number) => void
  onDelete: (id: string) => void
  onAdd: () => void
  addTitle: string
  /** when set, the track is path-driven: show this note instead of keyframes/add */
  note?: string
}) {
  const selection = useEditorStore((s) => s.selection)
  const selected = selection === selectId

  return (
    <div className="flex h-8 items-center gap-2">
      <button
        onClick={() => useEditorStore.getState().select(selected ? null : selectId)}
        className={`w-24 shrink-0 truncate rounded-md px-2 py-1 text-left text-[11px] ${
          selected ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
        }`}
      >
        {label}
      </button>
      <div className="relative h-full min-w-0 flex-1 rounded-md bg-panel-2/50">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-line" />
        {note ? (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] italic text-ink-dim">
            {note}
          </span>
        ) : (
          keys.map((k) => (
            <Keyframe
              key={k.id}
              id={k.id}
              time={k.time}
              color={color}
              title={k.title}
              onMove={onMove}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
      {note ? (
        <span className="w-6 shrink-0" />
      ) : (
        <button
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

export function Timeline() {
  const hasPath = usePathStore(selectCameraAnchorCount) >= 2
  const playing = useRigStore((s) => s.playing)
  const t = useRigStore((s) => s.t)
  const duration = useRigStore((s) => s.duration)
  const loop = useRigStore((s) => s.loop)
  const progressKeys = useRigStore((s) => s.progressKeys)
  const smoothness = useRigStore((s) => s.smoothness)
  const objects = useSceneStore((s) => s.objects)
  const paths = usePathStore((s) => s.paths)
  const playMode = useEditorStore((s) => s.playMode)

  const scrubbing = useRef(false)
  const areaRef = useRef<HTMLDivElement>(null)

  if (!hasPath || playMode) return null

  const rig = useRigStore.getState()
  const scene = useSceneStore.getState()

  const scrub = (e: ReactPointerEvent) => {
    if (!areaRef.current) return
    rig.setPlaying(false)
    rig.setT(timeFromEvent(e, areaRef.current))
  }

  // ruler ticks: 1 major per second (label every 1s up to 12s, else every 5s)
  const seconds = Math.ceil(duration)
  const labelEvery = duration <= 12 ? 1 : 5
  const ticks = Array.from({ length: seconds + 1 }, (_, i) => i)

  return (
    <div
      className="panel absolute bottom-3 left-[244px] right-[252px] z-20 flex flex-col px-3 py-2"
      style={{ height: TIMELINE_HEIGHT }}
    >
      {/* transport */}
      <div className="flex items-center gap-2 pb-1.5">
        <button
          title="Play / Pause (Space)"
          onClick={() => rig.setPlaying(!playing)}
          className={`flex h-7 w-7 items-center justify-center rounded-md ${
            playing ? 'bg-accent text-white' : 'bg-panel-2 text-ink hover:bg-panel-3'
          }`}
        >
          {playing ? <PauseIcon /> : <PlayIcon size={12} />}
        </button>
        <span className="w-20 text-[11px] tabular-nums text-ink-dim">
          {(t * duration).toFixed(2)}s / {duration.toFixed(1)}s
        </span>
        <button
          title="Repeat automatically"
          onClick={() => rig.setLoop(!loop)}
          className={`rounded-md px-2 py-0.5 text-[11px] ${
            loop ? 'bg-accent text-white' : 'text-ink-dim hover:text-ink'
          }`}
        >
          Loop
        </button>
        <span className="ml-auto text-[10px] text-ink-dim">
          Drag keyframes to retime · double-click to delete
        </span>
        <button
          onClick={() => void saveCurrentAsShot()}
          title="Snapshot this camera move as a shot on the Board"
          className="rounded-md bg-panel-2 px-2.5 py-1 text-[11px] text-ink hover:bg-panel-3"
        >
          Save shot
        </button>
      </div>

      {/* ruler + tracks share one aligned area */}
      <div className="flex items-stretch gap-2">
        <div className="w-24 shrink-0" />
        <div ref={areaRef} className="relative min-w-0 flex-1">
          {/* ruler */}
          <div
            className="relative h-6 cursor-col-resize select-none"
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
            {ticks.map((s) => (
              <div
                key={s}
                className="absolute bottom-0 top-0"
                style={{ left: `${(s / duration) * 100}%` }}
              >
                <div className="absolute bottom-0 h-2 w-px bg-line" />
                {s % labelEvery === 0 && s < duration && (
                  <span className="absolute bottom-2 translate-x-0.5 text-[9px] text-ink-dim">
                    {s}s
                  </span>
                )}
              </div>
            ))}
            <div className="absolute bottom-0 left-0 right-0 h-px bg-line" />
          </div>
        </div>
        <div className="w-6 shrink-0" />
      </div>

      {/* tracks */}
      <div className="relative flex-1 overflow-y-auto">
        <div className="flex flex-col gap-1 pt-1">
          <Track
            label="Camera"
            selectId="cinema-camera"
            color="#3b82f6"
            keys={progressKeys.map((k) => ({
              id: k.id,
              time: k.time,
              title: `${(k.time * duration).toFixed(1)}s → ${Math.round(k.progress * 100)}% of path`,
            }))}
            onMove={rig.updateProgressKeyTime}
            onDelete={rig.removeProgressKey}
            onAdd={() => {
              const state = useRigStore.getState()
              state.upsertProgressKey(
                state.t,
                evalProgress(state.t, state.progressKeys, smoothness),
              )
            }}
            addTitle="Pin the camera's path position at the playhead"
          />
          {objects.map((object) => {
            const followName = object.follow
              ? object.follow.pathId === CAMERA_PATH_ID
                ? 'Camera Path'
                : (paths.find((p) => p.id === object.follow!.pathId)?.name ?? 'path')
              : undefined
            return (
              <Track
                key={object.id}
                label={object.name}
                selectId={`obj:${object.id}`}
                color="#7c5cff"
                note={followName ? `follows ${followName}` : undefined}
                keys={object.keys.map((k) => ({
                  id: k.id,
                  time: k.time,
                  title: `${(k.time * duration).toFixed(1)}s — pose`,
                }))}
                onMove={(keyId, time) => scene.updateObjectKeyTime(object.id, keyId, time)}
                onDelete={(keyId) => scene.removeObjectKey(object.id, keyId)}
                onAdd={() => scene.addObjectKey(object.id, useRigStore.getState().t)}
                addTitle="Save the current pose at the playhead"
              />
            )
          })}
        </div>

        {/* playhead spanning the tracks area, aligned with the ruler lane */}
        <div
          className="pointer-events-none absolute bottom-0 top-[-28px]"
          style={{
            left: `calc(6.5rem + (100% - 6.5rem - 2rem) * ${t})`,
          }}
        >
          <div className="absolute bottom-0 top-0 w-px bg-accent" />
          <div className="absolute -top-0.5 -translate-x-1/2 rounded bg-accent px-1 py-px text-[9px] font-medium tabular-nums text-white">
            {(t * duration).toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  )
}
