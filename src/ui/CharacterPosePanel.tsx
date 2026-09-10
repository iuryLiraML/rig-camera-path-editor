import { useEffect, useRef } from 'react'
import { useSceneStore, type SceneObject } from '../state/useSceneStore'
import { useEditorStore } from '../state/useEditorStore'
import { beginHistoryTransaction } from '../lib/history'
import { DUMMY_BONE_LABELS, DUMMY_POSE_BONES, type DummyBoneName } from '../lib/dummyCharacter'
import { characterControls, characterControlValue, setCharacterControl, mirrorCharacterPose, resetCharacterJoints, type PoseControl } from '../lib/characterPose'

const groups: { label: string; bones: DummyBoneName[] }[] = [
  { label: 'Body', bones: ['Hips', 'Spine', 'Chest'] },
  { label: 'Head', bones: ['Neck', 'Head'] },
  { label: 'Left arm', bones: ['LeftClavicle', 'LeftArm', 'LeftForearm', 'LeftHand'] },
  { label: 'Right arm', bones: ['RightClavicle', 'RightArm', 'RightForearm', 'RightHand'] },
  { label: 'Left leg', bones: ['LeftLeg', 'LeftShin', 'LeftFoot'] },
  { label: 'Right leg', bones: ['RightLeg', 'RightShin', 'RightFoot'] },
]
const button = 'rounded border border-line px-2 py-1 text-[11px] text-ink hover:bg-panel-3 disabled:opacity-40'
function edit(work: () => void) { const end = beginHistoryTransaction(); try { work() } finally { end() } }

function ControlRow({ object, bone, input }: { object: SceneObject; bone: DummyBoneName; input: PoseControl }) {
  const transaction = useRef<ReturnType<typeof beginHistoryTransaction> | null>(null)
  const begin = () => { transaction.current ??= beginHistoryTransaction() }
  const finish = (cancel = false) => { transaction.current?.(cancel); transaction.current = null }
  useEffect(() => () => { transaction.current?.(true) }, [])
  const value = Math.round(characterControlValue(object, bone, input) * 10) / 10
  const label = `${DUMMY_BONE_LABELS[bone]} ${input.label}`
  return <div className="my-2" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(true) }
    else if ((event.target as HTMLInputElement).type === 'range' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) begin()
    else if (event.key === 'Enter') finish()
  }} onKeyUp={(event) => { if ((event.target as HTMLInputElement).type === 'range' && (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End')) finish() }}>
    <div className="flex items-center justify-between gap-2 text-[11px]"><span>{input.label}</span><div className="flex items-center gap-1"><input aria-label={`${label} degrees`} type="number" step={0.1} min={input.min} max={input.max} value={value} onKeyDown={(event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); event.stopPropagation(); begin()
        setCharacterControl(object.id, bone, input.id, value + (event.key === 'ArrowUp' ? 1 : -1))
      }
    }} onFocus={begin} onBlur={() => finish()} onChange={(event) => { if (event.target.value !== '') { begin(); setCharacterControl(object.id, bone, input.id, event.target.valueAsNumber) } }} className="w-16 rounded bg-panel-2 px-1 py-0.5 text-right" /><span>°</span><button className="text-ink-dim hover:text-ink" aria-label={`Reset ${label}`} onClick={() => edit(() => setCharacterControl(object.id, bone, input.id, 0))}>↺</button></div></div>
    <input aria-label={label} type="range" min={Math.min(input.min, value)} max={Math.max(input.max, value)} step={1} value={value} className="mt-1 w-full accent-accent" onPointerDown={(event) => { begin(); event.currentTarget.setPointerCapture?.(event.pointerId) }} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onBlur={() => finish()} onChange={(event) => { begin(); setCharacterControl(object.id, bone, input.id, event.target.valueAsNumber) }} />
  </div>
}

export function CharacterPosePanel({ objectId }: { objectId: string }) {
  const object = useSceneStore((state) => state.objects.find((item) => item.id === objectId))
  const handles = useEditorStore((state) => state.showPoseHandles)
  const workspace = useEditorStore((state) => state.workspaceMode)
  if (!object || object.rigKind !== 'dummy' || workspace === 'visualize') return null
  if (!object.root.userData.dummyGltf) return <p className="text-xs text-ink-dim">Pose controls require the Figure model. Loading…</p>
  return <section aria-label="Character pose" className="space-y-3 text-ink">
    <div className="flex items-center justify-between"><h3 className="text-xs font-medium">Pose</h3><span className="text-[10px] text-ink-dim">Figure rig</span></div>
    <div className="flex gap-2"><button className={button} aria-pressed={!object.playClips} onClick={() => edit(() => useSceneStore.getState().setPlayClips(object.id, false))}>Edit pose</button><button className={button} disabled={!object.clips.length} aria-pressed={object.playClips} onClick={() => edit(() => useSceneStore.getState().setPlayClips(object.id, true))}>Play clip</button></div>
    {object.playClips ? <label className="block text-xs">Clip<select aria-label="Character clip" value={object.activeClip ?? object.clips[0]?.name} onChange={(event) => edit(() => useSceneStore.getState().setActiveClip(object.id, event.target.value))} className="ml-2 rounded bg-panel-2 px-2 py-1">{object.clips.map((clip) => <option key={clip.uuid} value={clip.name}>{clip.name}</option>)}</select><p className="mt-2 text-ink-dim">Your manual pose is kept while this clip plays.</p></label> : <>
      {groups.map((group) => <details key={group.label} open={group.label === 'Left arm'} className="border-t border-line pt-2"><summary className="cursor-pointer text-xs">{group.label}</summary><div className="mt-2"><button className={button} onClick={() => edit(() => resetCharacterJoints(object.id, group.bones))}>Reset {group.label.toLowerCase()}</button>{group.bones.map((bone) => <div key={bone} className="mt-3"><div className="flex items-center justify-between"><h4 className="text-[10px] text-ink-dim">{DUMMY_BONE_LABELS[bone]}</h4><button className="text-[10px] text-ink-dim" aria-label={`Reset ${DUMMY_BONE_LABELS[bone]}`} onClick={() => edit(() => resetCharacterJoints(object.id, [bone]))}>Reset joint</button></div>{characterControls(bone).map((input) => <ControlRow key={input.id} object={object} bone={bone} input={input} />)}</div>)}</div></details>)}
      <div className="flex gap-2"><button className={button} onClick={() => edit(() => mirrorCharacterPose(object.id))}>Mirror pose</button><button className={button} onClick={() => edit(() => resetCharacterJoints(object.id, DUMMY_POSE_BONES))}>Reset pose</button></div>
      <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={handles} onChange={(event) => { useEditorStore.getState().setShowPoseHandles(event.target.checked); if (!event.target.checked) useEditorStore.getState().setDummyBone(null) }} />Advanced joint handles</label>
    </>}
  </section>
}
