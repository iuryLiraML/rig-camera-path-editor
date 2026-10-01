import { useEffect, useMemo, useRef } from 'react'
import { easeDef, easeGroups, type EaseKind } from '../../lib/easing'
import { objectKeyChannel, OBJECT_CHANNEL_LABELS } from '../../lib/keyframes'
import { applyTogglePlayback } from '../../lib/playback'
import { useEditorStore } from '../../state/useEditorStore'
import { useRigStore } from '../../state/useRigStore'
import { useSceneStore } from '../../state/useSceneStore'
import { beginHistoryTransaction } from '../../lib/history'
import { TransformPopover } from '../TransformPopover'
import { PlayIcon } from '../icons'

const CHANNEL_LABELS = {
  pose: 'Pose',
  ...OBJECT_CHANNEL_LABELS,
} as const

export function PhoneObjectAnimator() {
  const objects = useSceneStore((state) => state.objects)
  const selection = useEditorStore((state) => state.selection)
  const selectedKeyframe = useEditorStore((state) => state.selectedKeyframe)
  const duration = useRigStore((state) => state.duration)
  const t = useRigStore((state) => state.t)
  const playing = useRigStore((state) => state.playing)
  const ease = useRigStore((state) => state.ease)
  const selectedId = selection?.startsWith('obj:') ? selection.slice(4) : null
  const object = objects.find((item) => item.id === selectedId)
  const keys = useMemo(() => object ? [...object.keys].sort((a, b) => a.time - b.time) : [], [object])
  const selectedKey = selectedKeyframe?.kind === 'object' && selectedKeyframe.objectId === object?.id
    ? keys.find((key) => key.id === selectedKeyframe.id)
    : undefined
  const curve = selectedKey?.easeBezier ?? easeDef(selectedKey?.ease ?? ease).bezier
  const curvePreset = selectedKey?.easeBezier ? 'custom' : selectedKey?.ease ?? ease
  const curveTransaction = useRef<ReturnType<typeof beginHistoryTransaction> | null>(null)

  const finishCurveGesture = (cancel = false) => {
    curveTransaction.current?.(cancel)
    curveTransaction.current = null
  }
  const beginCurveGesture = () => {
    if (!curveTransaction.current) curveTransaction.current = beginHistoryTransaction()
  }

  useEffect(() => () => finishCurveGesture(), [])

  const selectObject = (id: string) => {
    useEditorStore.getState().select(id ? `obj:${id}` : null)
  }

  const openAddObjects = () => {
    useEditorStore.getState().setAddDrawerChip('primitives')
    useEditorStore.getState().setActiveTaskPanel('tools')
  }

  const selectKey = (key: (typeof keys)[number]) => {
    if (!object) return
    useEditorStore.getState().selectTimelineKey(
      { kind: 'object', objectId: object.id, id: key.id },
      `obj:${object.id}`,
    )
    useRigStore.getState().setT(key.time)
  }

  const setCurveHandle = (index: 0 | 1 | 2 | 3, value: number) => {
    if (!object || !selectedKey) return
    const next = [...curve] as [number, number, number, number]
    next[index] = value
    useSceneStore.getState().setObjectKeyBezier(object.id, selectedKey.id, next)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div>
        <h2 className="text-[13px] font-semibold text-ink">Animate an object</h2>
        <p className="mt-1 text-[11px] leading-4 text-ink-dim">
          Choose an object, set the playhead, then key its Position, Rotation, or Scale.
        </p>
      </div>

      {objects.length === 0 ? (
        <div className="panel flex flex-col items-start gap-2 p-3">
          <p className="text-[11px] leading-4 text-ink-dim">Add an object to the scene before creating object animation.</p>
          <button
            type="button"
            onClick={openAddObjects}
            className="min-h-11 rounded-md bg-accent px-3 text-[12px] font-medium text-white"
          >
            Add an object
          </button>
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-[10px] font-medium text-ink-dim">
            Scene object
            <select
              aria-label="Scene object"
              value={object?.id ?? ''}
              onChange={(event) => selectObject(event.target.value)}
              className="min-h-11 w-full rounded-md bg-panel-2 px-3 text-[12px] text-ink outline-none"
            >
              <option value="">Choose an object</option>
              {objects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>

          {object ? (
            <>
              <section className="panel p-3" aria-label="Animation playhead controls">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-ink">Playhead</span>
                  <span className="text-[11px] tabular-nums text-ink-dim">
                    {(t * duration).toFixed(2)}s / {duration.toFixed(2)}s
                  </span>
                  <button
                    type="button"
                    aria-label={playing ? 'Pause animation preview' : 'Play animation preview'}
                    onClick={applyTogglePlayback}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-panel-2 text-ink"
                  >
                    {playing ? 'Pause' : <PlayIcon size={12} />}
                  </button>
                </div>
                <input
                  aria-label="Animation playhead"
                  type="range"
                  min="0"
                  max="1"
                  step="any"
                  value={t}
                  onChange={(event) => {
                    useRigStore.getState().setPlaying(false)
                    useRigStore.getState().setT(Number(event.target.value))
                  }}
                  className="touch-range w-full accent-accent"
                />
              </section>

              <section className="panel p-2" aria-label={`${object.name} transform controls`}>
                <TransformPopover objectId={object.id} embedded />
              </section>

              <section className="panel p-3" aria-label="Object keyframes">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold text-ink">Keyframes</h3>
                  <span className="text-[10px] text-ink-dim">{keys.length}</span>
                </div>
                {keys.length === 0 ? (
                  <p className="text-[11px] leading-4 text-ink-dim">
                    Use a diamond beside a transform channel to add its first keyframe.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {keys.map((key) => {
                      const active = selectedKeyframe?.kind === 'object'
                        && selectedKeyframe.objectId === object.id
                        && selectedKeyframe.id === key.id
                      const channel = objectKeyChannel(key)
                      return (
                        <button
                          key={key.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => selectKey(key)}
                          className={`flex min-h-11 items-center justify-between rounded-md px-3 text-left text-[11px] ${
                            active ? 'bg-accent text-white' : 'bg-panel-2 text-ink hover:bg-panel-3'
                          }`}
                        >
                          <span>{CHANNEL_LABELS[channel]}</span>
                          <span className="tabular-nums">{(key.time * duration).toFixed(2)}s</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>

              {selectedKey && (
                <section className="panel flex flex-col gap-3 p-3" aria-label="Selected keyframe curve">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-[11px] font-semibold text-ink">Curve</h3>
                      <p className="text-[10px] text-ink-dim">Outgoing curve for this keyframe</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        useSceneStore.getState().removeObjectKey(object.id, selectedKey.id)
                        useEditorStore.getState().selectKeyframe(null)
                      }}
                      className="min-h-11 rounded-md px-3 text-[11px] text-ink-dim hover:bg-panel-2 hover:text-ink"
                    >
                      Remove key
                    </button>
                  </div>
                  <label className="flex flex-col gap-1 text-[10px] text-ink-dim">
                    Curve preset
                    <select
                      aria-label="Curve preset"
                      value={curvePreset}
                      onChange={(event) => {
                        if (event.target.value !== 'custom') {
                          useSceneStore.getState().setObjectKeyEase(
                            object.id,
                            selectedKey.id,
                            event.target.value as EaseKind,
                          )
                        }
                      }}
                      className="min-h-11 w-full rounded-md bg-panel-2 px-3 text-[12px] text-ink outline-none"
                    >
                      <option value="custom" disabled={!selectedKey.easeBezier}>Custom Bézier</option>
                      {easeGroups().map((group) => (
                        <optgroup key={group.group} label={group.group}>
                          {group.items.map((item) => (
                            <option key={item.kind} value={item.kind}>{item.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <CurvePreview values={curve} />
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    {([
                      ['x1', 'First handle time', 0],
                      ['y1', 'First handle progress', 1],
                      ['x2', 'Second handle time', 2],
                      ['y2', 'Second handle progress', 3],
                    ] as const).map(([label, accessible, index]) => (
                      <label key={label} className="flex min-w-0 flex-col gap-1 text-[10px] text-ink-dim">
                        <span className="flex justify-between gap-1"><span>{label}</span><span>{curve[index].toFixed(2)}</span></span>
                        <input
                          type="range"
                          aria-label={accessible}
                          min={index === 1 || index === 3 ? -1 : 0}
                          max={index === 1 || index === 3 ? 2 : 1}
                          step="0.01"
                          value={curve[index]}
                          onChange={(event) => setCurveHandle(index, Number(event.target.value))}
                          onPointerDown={beginCurveGesture}
                          onPointerUp={() => finishCurveGesture()}
                          onPointerCancel={() => finishCurveGesture(true)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') finishCurveGesture(true)
                          }}
                          className="touch-range w-full accent-accent"
                        />
                      </label>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-[10px] text-ink-dim">
                    <span className="w-24 shrink-0">Key time</span>
                    <input
                      type="range"
                      aria-label="Selected keyframe time"
                      min="0"
                      max="1"
                      step="0.01"
                      value={selectedKey.time}
                      onChange={(event) => useSceneStore.getState().updateObjectKeyTime(object.id, selectedKey.id, Number(event.target.value))}
                      className="touch-range w-full accent-accent"
                    />
                    <span className="w-10 shrink-0 text-right tabular-nums">{(selectedKey.time * duration).toFixed(2)}s</span>
                  </label>
                </section>
              )}
            </>
          ) : (
            <p className="text-[11px] leading-4 text-ink-dim">Choose a scene object to edit its transform and animation.</p>
          )}
        </>
      )}
    </div>
  )
}

function CurvePreview({ values: [x1, y1, x2, y2] }: { values: [number, number, number, number] }) {
  return (
    <svg
      role="img"
      aria-label="Animation curve preview"
      viewBox="0 0 100 100"
      className="h-24 w-full rounded-md bg-panel-2 p-2"
      preserveAspectRatio="none"
    >
      <path d="M 0 100 L 100 0" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeDasharray="3 3" />
      <path
        d={`M 0 100 C ${x1 * 100} ${(1 - y1) * 100}, ${x2 * 100} ${(1 - y2) * 100}, 100 0`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-accent"
      />
    </svg>
  )
}
