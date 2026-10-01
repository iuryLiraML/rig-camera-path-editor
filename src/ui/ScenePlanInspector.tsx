import { useEffect, useRef } from 'react'
import { findRoomByKey, isRectangularRoom, resizeScenePlanRoom, resizeScenePlanWall, updateScenePlanOpening, updateScenePlanWall } from '../lib/scenePlan'
import { openingCenter, planFromJSON, wallLength, type PlanRoom, type PlanWall, type StoredPlan } from '../lib/floorPlanModel'
import { createPlanAssetFromScenePlan } from '../lib/library'
import { beginHistoryTransaction } from '../lib/history'
import { observeTutorialScenePlanCommitted } from '../lib/tutorial/tutorialObservation'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { Section, Slider } from './primitives'

type FinishTransaction = (cancel?: boolean) => void

function metre(value: number): string {
  return `${value.toFixed(2)} m`
}

/** Contextual controls for one selected, scene-local Plan instance. */
export function ScenePlanInspector({ objectId }: { objectId: string }) {
  const object = useSceneStore((state) => state.objects.find((item) => item.id === objectId))
  const workspaceMode = useEditorStore((state) => state.workspaceMode)
  const edit = useEditorStore((state) => state.scenePlanEdit)
  const transaction = useRef<FinishTransaction | null>(null)
  const editing = workspaceMode === 'build' && edit?.objectId === objectId

  const finish = (cancel = false) => {
    const hadTransaction = Boolean(transaction.current)
    transaction.current?.(cancel)
    transaction.current = null
    if (hadTransaction && !cancel) observeTutorialScenePlanCommitted(objectId)
  }
  const begin = () => {
    finish()
    transaction.current = beginHistoryTransaction()
  }

  useEffect(() => () => finish(), [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !transaction.current) return
      event.preventDefault()
      finish(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!object?.plan) return null

  const plan = planFromJSON(object.plan)
  const target = editing ? edit.target : null
  const commit = (result: ReturnType<typeof updateScenePlanWall>) => {
    if (result.changed) useSceneStore.getState().setScenePlan(objectId, result.plan)
    if (result.note) useSceneStore.getState().showNotice(result.note, 1800)
  }
  const saveAsNewPlan = async () => {
    const name = `${object.name} plan`
    await createPlanAssetFromScenePlan(object.plan!, name)
    useSceneStore.getState().showNotice(`Saved “${name}” to Library`)
  }

  if (workspaceMode !== 'build') {
    return (
      <Section title="Scene Plan">
        <p className="text-[11px] leading-4 text-ink-dim">Structural controls are available in Build.</p>
        <button type="button" aria-label="Edit in Build" onClick={() => useEditorStore.getState().startScenePlanEdit(objectId)} className="min-h-11 rounded-md bg-panel-2 px-3 text-[11px] text-ink hover:bg-panel-3">Edit in Build</button>
      </Section>
    )
  }

  if (!editing) {
    return (
      <Section title="Scene Plan">
        <p className="text-[11px] leading-4 text-ink-dim">This is a local copy. Editing it never changes the reusable Library Plan.</p>
        <button type="button" data-tour="scene-plan-edit" aria-label="Edit Plan" onClick={() => useEditorStore.getState().startScenePlanEdit(objectId)} className="min-h-11 rounded-md bg-accent px-3 text-[11px] font-medium text-white hover:bg-accent/85">Edit Plan</button>
        <button type="button" onClick={() => void saveAsNewPlan()} className="min-h-11 rounded-md bg-panel-2 px-3 text-[11px] text-ink hover:bg-panel-3">Save as new Plan</button>
      </Section>
    )
  }

  const selectedRoom = target?.kind === 'room' ? findRoomByKey(plan, target.roomKey) : undefined
  const selectedRoomKey = target?.kind === 'room' ? target.roomKey : ''
  const selectedWall = target?.kind === 'wall' ? plan.walls.find((wall) => wall.id === target.wallId) : undefined
  const selectedOpening = target?.kind === 'opening' ? plan.openings.find((opening) => opening.id === target.openingId) : undefined

  return (
    <Section title="Scene Plan">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-accent">Edit mode</p>
        <button type="button" aria-label="Done editing Plan" onClick={() => useEditorStore.getState().stopScenePlanEdit()} className="min-h-11 rounded-md bg-panel-2 px-3 text-[11px] text-ink hover:bg-panel-3">Done</button>
      </div>
      {!target && <p className="rounded-md bg-panel-2 px-2 py-1.5 text-[11px] leading-4 text-ink-dim">Click a room floor, wall, door, or window in the viewport to edit it.</p>}
      {selectedRoom && <RoomControls plan={object.plan} roomKey={selectedRoomKey} room={selectedRoom} begin={begin} finish={finish} commit={commit} />}
      {selectedWall && <WallControls plan={object.plan} wallId={selectedWall.id} wall={selectedWall} begin={begin} finish={finish} commit={commit} />}
      {selectedOpening && <OpeningControls plan={object.plan} openingId={selectedOpening.id} begin={begin} finish={finish} commit={commit} />}
      <button type="button" onClick={() => void saveAsNewPlan()} className="min-h-11 rounded-md bg-panel-2 px-3 text-[11px] text-ink hover:bg-panel-3">Save as new Plan</button>
    </Section>
  )
}

type Controls = {
  begin: () => void
  finish: (cancel?: boolean) => void
  commit: (result: ReturnType<typeof updateScenePlanWall>) => void
}

function GestureSlider({ label, ariaLabel, value, min, max, step, onChange, begin, finish }: {
  label: string; ariaLabel?: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void
  begin: () => void; finish: (cancel?: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-ink-dim">
      <span className="w-16 shrink-0">{label}</span>
      <Slider value={value} min={min} max={max} step={step} format={metre} onChange={onChange} onGestureStart={begin} onGestureEnd={() => finish()} onGestureCancel={() => finish(true)} ariaLabel={ariaLabel ?? label} />
    </label>
  )
}

function RoomControls({ plan, roomKey, room, begin, finish, commit }: { plan: StoredPlan; roomKey: string; room: PlanRoom | undefined; } & Controls) {
  if (!room) return null
  if (!isRectangularRoom(room)) {
    return <p className="rounded-md bg-panel-2 px-2 py-1.5 text-[11px] leading-4 text-ink-dim">
      This irregular Room is edited by selecting its Walls.
    </p>
  }
  const width = Math.hypot(room.points[1]!.x - room.points[0]!.x, room.points[1]!.y - room.points[0]!.y)
  const depth = Math.hypot(room.points[3]!.x - room.points[0]!.x, room.points[3]!.y - room.points[0]!.y)
  return <>
    <p className="text-[11px] font-medium text-ink">Room</p>
    <GestureSlider label="Width" value={width} min={0.25} max={20} step={0.05} begin={begin} finish={finish} onChange={(value) => commit(resizeScenePlanRoom(plan, roomKey, { width: value }))} />
    <GestureSlider label="Depth" value={depth} min={0.25} max={20} step={0.05} begin={begin} finish={finish} onChange={(value) => commit(resizeScenePlanRoom(plan, roomKey, { depth: value }))} />
  </>
}

function WallControls({ plan, wallId, wall, begin, finish, commit }: { plan: StoredPlan; wallId: string; wall: PlanWall } & Controls) {
  return <>
    <p className="text-[11px] font-medium text-ink">Wall</p>
    <GestureSlider label="Length" ariaLabel="Wall length" value={wallLength(wall)} min={0.25} max={20} step={0.05} begin={begin} finish={finish} onChange={(value) => commit(resizeScenePlanWall(plan, wallId, value))} />
    <GestureSlider label="Height" ariaLabel="Wall height" value={wall.height} min={0.5} max={8} step={0.05} begin={begin} finish={finish} onChange={(value) => commit(updateScenePlanWall(plan, wallId, { height: value }))} />
    <GestureSlider label="Thickness" ariaLabel="Wall thickness" value={wall.thickness} min={0.05} max={0.6} step={0.01} begin={begin} finish={finish} onChange={(value) => commit(updateScenePlanWall(plan, wallId, { thickness: value }))} />
  </>
}

function OpeningControls({ plan, openingId, begin, finish, commit }: { plan: StoredPlan; openingId: string } & Controls) {
  const state = planFromJSON(plan)
  const opening = state.openings.find((item) => item.id === openingId)
  const center = opening ? openingCenter(state, opening) : null
  if (!opening || !center) return null
  const update = (patch: Parameters<typeof updateScenePlanOpening>[2]) => commit(updateScenePlanOpening(plan, openingId, patch))
  return <>
    <p className="text-[11px] font-medium text-ink">{opening.kind === 'door' ? 'Door' : 'Window'}</p>
    <GestureSlider label="Position" value={opening.along} min={opening.width / 2} max={center.L - opening.width / 2} step={0.05} begin={begin} finish={finish} onChange={(value) => update({ along: value })} />
    <GestureSlider label="Width" value={opening.width} min={0.3} max={center.L} step={0.05} begin={begin} finish={finish} onChange={(value) => update({ width: value })} />
    <GestureSlider label="Height" value={opening.height} min={0.3} max={center.wall.height - opening.sill} step={0.05} begin={begin} finish={finish} onChange={(value) => update({ height: value })} />
    {opening.kind === 'window' && <GestureSlider label="Sill" value={opening.sill} min={0} max={center.wall.height - opening.height} step={0.05} begin={begin} finish={finish} onChange={(value) => update({ sill: value })} />}
  </>
}
