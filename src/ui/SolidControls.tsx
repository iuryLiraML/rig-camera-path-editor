import { useState } from 'react'
import type { SceneObject } from '../state/useSceneStore'
import { useSceneStore } from '../state/useSceneStore'
import { useSolidSelectionStore } from '../state/useSolidSelectionStore'
import { booleanPrimitive, primitiveMesh, solidEditNotice } from '../lib/solidEditing'
import { primitiveTopology, PRIMITIVE_DEFS, type CadVec3 } from '../lib/primitiveGeometry'
import { PrimitivePreview } from './PrimitivePreview'
import { Row, Slider, meters } from './primitives'

export function PrimitiveShapeControls({ object }: { object: SceneObject }) {
  if (!object.primitive) return null
  return <>
    {PRIMITIVE_DEFS[object.primitive.kind].params.map((def) => <Row key={def.key} label={def.label}>
      <Slider value={object.primitive!.params[def.key] ?? def.default} min={def.min} max={def.max} step={def.step} format={def.step >= 1 ? (n) => String(Math.round(n)) : meters}
        onChange={(v) => solidEditNotice(() => useSceneStore.getState().updatePrimitiveParams(object.id, { [def.key]: v }))} />
    </Row>)}
    <SolidControls key={object.id} object={object} />
  </>
}

const button = 'rounded-md bg-panel-2 px-2 py-1 text-[11px] text-ink disabled:opacity-40 hover:bg-line'
export function SolidControls({ object }: { object: SceneObject }) {
  const { mode, selection } = useSolidSelectionStore()
  const objects = useSceneStore((s) => s.objects)
  const [distance, setDistance] = useState(0.5)
  const [operand, setOperand] = useState('')
  const [axis, setAxis] = useState('y')
  const [offset, setOffset] = useState(0)
  const [keep, setKeep] = useState<'positive' | 'negative'>('positive')
  const topology = primitiveTopology(primitiveMesh(object).geometry)
  const selectedFace = selection?.objectId === object.id ? selection.face : undefined
  const faces = topology.faces.filter((face) => face.triangles.length >= 2)
  const cutters = objects.filter((o) => o.id !== object.id && o.primitive && o.rigKind !== 'dummy')
  const edit = (fn: () => void) => solidEditNotice(() => { fn(); useSolidSelectionStore.setState({ selection: null }) })
  return <div className="space-y-2 pt-2" data-solid-controls>
    <div className="mx-auto h-24 w-24" data-solid-preview><PrimitivePreview kind={object.primitive!.kind} spec={object.primitive} /></div>
    <div className="flex gap-1" role="group" aria-label="Solid selection">
      {(['body', 'face', 'edge'] as const).map((item) => <button key={item} type="button" className={button} aria-pressed={mode === item} onClick={() => useSolidSelectionStore.setState({ mode: item, selection: null })}>{item[0].toUpperCase() + item.slice(1)}</button>)}
    </div>
    {mode === 'edge' && <p className="text-[10px] text-ink-dim">Click a boundary edge to select it. {selection?.objectId === object.id && selection.edge != null ? `Edge ${selection.edge + 1} selected.` : ''}</p>}
    {mode === 'face' && <>
      <select aria-label="Planar face" className="w-full rounded bg-panel-2 p-1 text-[11px] text-ink" value={selectedFace ? faces.findIndex((f) => JSON.stringify(f.ref) === JSON.stringify(selectedFace)) : -1} onChange={(e) => {
        const face = faces[Number(e.target.value)]
        useSolidSelectionStore.setState({ selection: face ? { objectId: object.id, face: face.ref } : null })
      }}>
        <option value={-1}>Select a planar face</option>
        {faces.map((face, i) => <option value={i} key={i}>Face {i + 1} · normal {face.normal.map((v) => v.toFixed(1)).join(', ')}</option>)}
      </select>
      <label className="flex items-center justify-between gap-2 text-[11px] text-ink-dim">Extrude distance (m)<input aria-label="Extrude distance" type="number" step="0.1" value={distance} onChange={(e) => setDistance(e.target.valueAsNumber)} className="w-16 rounded bg-panel-2 p-1 text-ink" /></label>
      <button type="button" className={button} disabled={!selectedFace || !Number.isFinite(distance) || distance === 0} onClick={() => edit(() => useSceneStore.getState().appendPrimitiveOp(object.id, { type: 'extrude', face: selectedFace!, distance }))}>Extrude face</button>
    </>}
    <div className="space-y-1 border-t border-line pt-2">
      <select aria-label="Boolean operand" className="w-full rounded bg-panel-2 p-1 text-[11px] text-ink" value={operand} onChange={(e) => setOperand(e.target.value)}><option value="">Choose another solid</option>{cutters.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
      <div className="flex gap-1">{(['union', 'subtract', 'intersect'] as const).map((op) => <button type="button" className={button} key={op} disabled={!cutters.some((o) => o.id === operand)} onClick={() => edit(() => booleanPrimitive(object.id, operand, op))}>{op[0].toUpperCase() + op.slice(1)}</button>)}</div>
      <p className="text-[10px] text-ink-dim">Uses the other solid at this time. The source stays in the scene.</p>
    </div>
    <div className="space-y-1 border-t border-line pt-2">
      <p className="text-[11px] text-ink-dim">Slice plane · local coordinates</p>
      <div className="flex items-center gap-1">
        <select aria-label="Slice axis" className="rounded bg-panel-2 p-1 text-[11px] text-ink" value={axis} onChange={(e) => setAxis(e.target.value)}>{['x', 'y', 'z'].map((v) => <option key={v} value={v}>{v.toUpperCase()}</option>)}</select>
        <input aria-label="Slice offset" type="number" step="0.1" value={offset} onChange={(e) => setOffset(e.target.valueAsNumber)} className="w-16 rounded bg-panel-2 p-1 text-[11px] text-ink" />
        <select aria-label="Slice side" className="min-w-0 rounded bg-panel-2 p-1 text-[11px] text-ink" value={keep} onChange={(e) => setKeep(e.target.value as typeof keep)}><option value="positive">Keep +</option><option value="negative">Keep −</option></select>
      </div>
      <button type="button" className={button} disabled={!Number.isFinite(offset)} onClick={() => edit(() => useSceneStore.getState().appendPrimitiveOp(object.id, { type: 'slice', normal: ['x', 'y', 'z'].map((v) => v === axis ? 1 : 0) as CadVec3, offset, keep }))}>Slice solid</button>
    </div>
    {!!object.primitive?.ops?.length && <div className="space-y-1 border-t border-line pt-2">
      <ol className="list-inside list-decimal text-[10px] text-ink-dim">{object.primitive.ops.map((op, i) => <li key={i}>{op.type === 'boolean' ? op.mode : op.type}</li>)}</ol>
      <button type="button" className={button} onClick={() => edit(() => useSceneStore.getState().removeLastPrimitiveOp(object.id))}>Remove last operation</button>
    </div>}
  </div>
}
