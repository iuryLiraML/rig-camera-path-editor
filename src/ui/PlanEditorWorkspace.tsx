/**
 * The floor-plan editor: a full-page 2D canvas over the app's dark tokens,
 * reached from the Library. Drawing is wall-first — the Room tool stamps a
 * rectangle, the Wall tool chains corners — and the Select tool edits what
 * you drew: drag a shared corner and every wall meeting there follows, drag a
 * whole wall, delete either, and undo each drag as one step.
 *
 * Every handler reads the live model from the store rather than a closed-over
 * render value, so a gesture always acts on the current plan — never on a
 * stale snapshot from an earlier render.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULTS,
  OPENING_SPEC,
  hitTest,
  nearestWall,
  openingEndpoints,
  openingPlacement,
  planActions,
  planRooms,
  planVertices,
  pointKey,
  snapPoint,
  wallBasis,
  wallLength,
  type PlanPoint,
  type PlanOpening,
} from '../lib/floorPlanModel'
import { leavePlan, renameActivePlan, saveActivePlan, usePlanEditorStore } from '../lib/planEditor'
import { useLibraryStore } from '../lib/library'
import { PlanPreview3D } from './PlanPreview3D'
import { PlanToolbar } from './PlanToolbar'

type Drag =
  | { kind: 'pan' }
  | { kind: 'stamp'; from: PlanPoint }
  | { kind: 'vertex'; key: string; started?: boolean }
  | { kind: 'wall'; id: string; last: PlanPoint; started?: boolean }
  | { kind: 'opening'; id: string; started?: boolean }
  | null

/** The live model, read at event time rather than captured at render time. */
const live = () => {
  const s = usePlanEditorStore.getState()
  return { plan: s.plan, tool: s.tool, sel: s.sel }
}

/** Keep the typed decimal intact while external edits and undo still refresh the field. */
function PlanNumber({ label, value, step, min, onChange }: { label: string; value: number; step: number; min: number; onChange: (value: number) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { if (document.activeElement !== ref.current) setDraft(String(value)) }, [value])
  return <label className="mb-2 flex items-center justify-between gap-2 text-[11px] text-ink-dim">
    {label}
    <input ref={ref} type="number" aria-label={label} step={step} min={min} value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        const number = e.target.valueAsNumber
        if (Number.isFinite(number) && number >= min) { onChange(number); usePlanEditorStore.getState().publish() }
      }}
      onBlur={() => setDraft(String(value))}
      className="w-20 rounded-md border border-line bg-panel-2 px-2 py-1 text-[11px] text-ink focus:border-accent focus:outline-none"
    />
  </label>
}

/** The inspector: edits the selected wall or opening, or every wall when nothing is selected. */
function PlanInspector() {
  const plan = usePlanEditorStore((s) => s.plan)
  const sel = usePlanEditorStore((s) => s.sel)
  const tool = usePlanEditorStore((s) => s.tool)
  const [, force] = useState(0)
  const redraw = useCallback(() => { usePlanEditorStore.getState().publish(); force((n) => n + 1) }, [])

  const num = (label: string, value: number, step: number, min: number, onChange: (v: number) => void) => (
    <PlanNumber key={`${sel?.kind ?? 'all'}-${sel && 'id' in sel ? sel.id : ''}-${label}`} label={label} value={value} step={step} min={min} onChange={onChange} />
  )

  if (tool === 'door' || tool === 'window') {
    const spec = OPENING_SPEC[tool]
    return <aside aria-label="Opening placement" className="w-44 shrink-0 overflow-y-auto border-l border-line bg-panel p-3">
      <h3 className="mb-3 text-xs font-medium text-ink">Place a {tool}</h3>
      <dl className="space-y-2 text-[11px] text-ink-dim">
        <div className="flex justify-between"><dt>Width</dt><dd>{spec.width.toFixed(2)} m</dd></div>
        <div className="flex justify-between"><dt>Height</dt><dd>{spec.height.toFixed(2)} m</dd></div>
        {tool === 'window' && <div className="flex justify-between"><dt>Sill</dt><dd>{spec.sill.toFixed(2)} m</dd></div>}
      </dl>
      <p className="mt-4 text-[11px] leading-relaxed text-ink-dim">Move over a wall to preview. Click to place, then drag or edit its dimensions.</p>
      {tool === 'door' && <p className="mt-3 text-[11px] text-ink-dim">Press F to flip the swing.</p>}
      <p className="mt-3 text-[11px] text-ink-dim">Escape cancels placement.</p>
    </aside>
  }

  let body: React.ReactNode
  if (!sel) {
    body = plan.walls.length ? (
      <>
        <p className="mb-2 text-[11px] text-ink-dim">Nothing selected. Applies to all walls.</p>
        {num('All heights', plan.walls[0]!.height, 0.1, 1, (v) => planActions.setAllWalls(plan, { height: v }))}
        {num('All thicknesses', plan.walls[0]!.thickness, 0.05, 0.05, (v) => planActions.setAllWalls(plan, { thickness: v }))}
      </>
    ) : (
      <p className="text-[11px] text-ink-dim">Nothing selected. Click a wall, a corner, or an opening.</p>
    )
  } else if (sel.kind === 'wall') {
    const w = plan.walls.find((x) => x.id === sel.id)
    if (!w) return null
    body = (
      <>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] text-ink-dim">Length</span>
          <span className="text-[11px] text-ink">{wallLength(w).toFixed(2)} m</span>
        </div>
        {num('Height', w.height, 0.1, 1, (v) => planActions.setWall(plan, w.id, { height: v }))}
        {num('Thickness', w.thickness, 0.05, 0.05, (v) => planActions.setWall(plan, w.id, { thickness: v }))}
      </>
    )
  } else if (sel.kind === 'opening') {
    const o = plan.openings.find((x) => x.id === sel.id)
    if (!o) return null
    body = (
      <>
        <div className="mb-2 flex gap-1 rounded-lg bg-panel-2 p-0.5">
          {(['door', 'window'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={o.kind === k}
              onClick={() => { planActions.setOpening(plan, o.id, { kind: k, ...OPENING_SPEC[k] }); redraw() }}
              className={`flex-1 rounded-md px-2 py-1 text-[11px] capitalize ${o.kind === k ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:text-ink'}`}
            >
              {k}
            </button>
          ))}
        </div>
        {num('Width', o.width, 0.1, 0.3, (v) => planActions.setOpening(plan, o.id, { width: v }))}
        {num('Height', o.height, 0.1, 0.3, (v) => planActions.setOpening(plan, o.id, { height: v }))}
        {num('Sill', o.sill, 0.1, 0, (v) => planActions.setOpening(plan, o.id, { sill: v }))}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] text-ink-dim">Along wall</span>
          <span className="text-[11px] text-ink">{o.along.toFixed(2)} m</span>
        </div>
        {o.kind === 'door' && <button
          type="button"
          onClick={() => { planActions.flipOpening(plan, o.id); redraw() }}
          className="w-full rounded-md border border-line bg-panel-2 px-2 py-1 text-[11px] text-ink hover:bg-panel-3"
        >
          Flip swing (F)
        </button>}
      </>
    )
  } else if (sel.kind === 'vertex') {
    const v = planVertices(plan.walls).find((x) => x.key === sel.key)
    if (!v) return null
    body = (
      <>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] text-ink-dim">Corner</span>
          <span className="text-[11px] text-ink">{v.x.toFixed(2)}, {v.y.toFixed(2)}</span>
        </div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] text-ink-dim">Walls joined</span>
          <span className="text-[11px] text-ink">{v.count}</span>
        </div>
      </>
    )
  }

  return (
    <div className="w-44 shrink-0 overflow-y-auto border-l border-line bg-panel p-3">
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-ink-dim">Inspector</h3>
      {body}
      {sel && <div className="mt-3 flex flex-col gap-2">
        <button type="button" onClick={() => usePlanEditorStore.getState().setSel(null)} className="rounded border border-line px-2 py-1 text-xs">Clear selection</button>
        <button type="button" onClick={() => { if (sel.kind === 'vertex') planActions.removeVertex(plan, sel.key); else planActions.remove(plan, sel.id); usePlanEditorStore.getState().setSel(null); redraw() }} className="rounded border border-line px-2 py-1 text-xs">Delete selected</button>
      </div>}
    </div>
  )
}

export function PlanEditorWorkspace() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const plan = usePlanEditorStore((s) => s.plan)
  const tool = usePlanEditorStore((s) => s.tool)
  const setTool = usePlanEditorStore((s) => s.setTool)
  const sel = usePlanEditorStore((s) => s.sel)
  const setSel = usePlanEditorStore((s) => s.setSel)
  const fitNonce = usePlanEditorStore((s) => s.fitNonce)
  const assetId = usePlanEditorStore((s) => s.assetId)
  const note = usePlanEditorStore((s) => s.note)
  const [saveMessage, setSaveMessage] = useState('')
  useEffect(() => setSaveMessage(''), [plan.version, assetId])
  const save = async () => {
    setSaveMessage('Saving…')
    try { await saveActivePlan(); setSaveMessage('Saved to Library') }
    catch { setSaveMessage('Could not save. Please try again.') }
  }
  const asset = useLibraryStore((s) => s.assets.find((a) => a.id === assetId))
  const [view, setView] = useState({ x: 120, y: 120, scale: 52 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [snapOn, setSnapOn] = useState(true)
  const snapRef = useRef(snapOn)
  snapRef.current = snapOn
  const dragRef = useRef<Drag>(null)
  const mouseRef = useRef<PlanPoint>({ x: 0, y: 0 })
  const spaceRef = useRef(false)
  const hoverRef = useRef<ReturnType<typeof openingPlacement> | null>(null)
  const openingSide = useRef<1 | -1>(1)
  const [, force] = useState(0)
  const redraw = useCallback(() => { usePlanEditorStore.getState().publish(); force((n) => n + 1) }, [])

  const toWorld = useCallback((ev: { clientX: number; clientY: number }): PlanPoint => {
    const r = canvasRef.current!.getBoundingClientRect()
    const v = viewRef.current
    return { x: (ev.clientX - r.left - v.x) / v.scale, y: (ev.clientY - r.top - v.y) / v.scale }
  }, [])

  // ---- drawing -----------------------------------------------------------
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    c.width = c.clientWidth * dpr
    c.height = c.clientHeight * dpr
    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, c.clientWidth, c.clientHeight)
    const px = (p: PlanPoint) => ({ x: p.x * view.scale + view.x, y: p.y * view.scale + view.y })

    const step = view.scale * DEFAULTS.grid
    ctx.lineWidth = 1
    for (let i = Math.floor(-view.x / step); i * step + view.x < c.clientWidth; i++) {
      const x = i * step + view.x
      ctx.strokeStyle = Math.abs((i * DEFAULTS.grid) % 1) < 1e-6 ? '#212127' : '#191920'
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.clientHeight); ctx.stroke()
    }
    for (let i = Math.floor(-view.y / step); i * step + view.y < c.clientHeight; i++) {
      const y = i * step + view.y
      ctx.strokeStyle = Math.abs((i * DEFAULTS.grid) % 1) < 1e-6 ? '#212127' : '#191920'
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.clientWidth, y); ctx.stroke()
    }

    for (const r of planRooms(plan.walls)) {
      ctx.beginPath()
      r.points.forEach((p, i) => { const q = px(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y) })
      ctx.closePath()
      ctx.fillStyle = 'rgba(59,130,246,0.07)'
      ctx.fill()
      const cc = px(r.center)
      ctx.fillStyle = '#8a8a93'
      ctx.font = '500 11px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`${r.area.toFixed(1)} m²`, cc.x, cc.y)
    }

    for (const w of plan.walls) {
      const a = px(w.a), b = px(w.b)
      const selWall = sel?.kind === 'wall' && sel.id === w.id
      ctx.strokeStyle = selWall ? '#3b82f6' : '#3a3a42'
      ctx.lineWidth = Math.max(4, w.thickness * view.scale)
      ctx.lineCap = 'butt'
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      ctx.strokeStyle = selWall ? '#93c5fd' : '#55555f'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      const L = wallLength(w)
      {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        const nx = -(b.y - a.y) / ((L || 1e-9) * view.scale), ny = (b.x - a.x) / ((L || 1e-9) * view.scale)
        ctx.fillStyle = selWall ? '#93c5fd' : '#6e6e78'
        ctx.font = '10px Inter, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(L.toFixed(2), mx + nx * 13, my + ny * 13 + 3)
      }
    }

    const drawOpening = (o: PlanOpening, color: string, ghost = false) => {
      const w = plan.walls.find((wall) => wall.id === o.wallId)
      if (!w) return
      const width = Math.min(o.width, wallLength(w))
      const along = Math.max(width / 2, Math.min(wallLength(w) - width / 2, o.along))
      const { p1, p2 } = openingEndpoints(w, along, width)
      const a = px(p1), b = px(p2)
      const { ux, uy } = wallBasis(w)
      ctx.save()
      ctx.strokeStyle = '#0f0f11'
      ctx.lineWidth = Math.max(6, w.thickness * view.scale + 2)
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      if (ghost) ctx.setLineDash([4, 3])
      if (o.kind === 'door') {
        const radius = Math.hypot(b.x - a.x, b.y - a.y)
        const angle = Math.atan2(uy, ux)
        const end = angle + o.side * Math.PI / 2
        ctx.beginPath(); ctx.arc(a.x, a.y, radius, angle, end, o.side < 0); ctx.stroke()
        ctx.setLineDash([])
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + Math.cos(end) * radius, a.y + Math.sin(end) * radius); ctx.stroke()
      } else {
        const offset = Math.max(2.5, w.thickness * view.scale / 2)
        for (const side of [-1, 1]) {
          const dx = -uy * offset * side, dy = ux * offset * side
          ctx.beginPath(); ctx.moveTo(a.x + dx, a.y + dy); ctx.lineTo(b.x + dx, b.y + dy); ctx.stroke()
        }
        ctx.setLineDash([])
        for (const p of [a, b]) {
          ctx.beginPath(); ctx.moveTo(p.x - uy * offset, p.y + ux * offset); ctx.lineTo(p.x + uy * offset, p.y - ux * offset); ctx.stroke()
        }
      }
      ctx.restore()
    }
    for (const o of plan.openings) {
      drawOpening(o, sel?.kind === 'opening' && sel.id === o.id ? '#93c5fd' : '#b9b9c3')
    }

    for (const v of planVertices(plan.walls)) {
      const q = px(v)
      const selV = sel?.kind === 'vertex' && sel.key === v.key
      ctx.fillStyle = selV ? '#3b82f6' : '#55555f'
      ctx.beginPath(); ctx.arc(q.x, q.y, selV ? 5 : 3.5, 0, 7); ctx.fill()
    }

    const hov = hoverRef.current
    if ((tool === 'door' || tool === 'window') && hov?.opening.kind === tool) {
      drawOpening(hov.opening, hov.issue ? '#f43f5e' : '#60a5fa', true)
    }

    if (plan.chain) {
      const anchor = plan.chain.points[plan.chain.points.length - 1]!
      const s = snapPoint(mouseRef.current, anchor, plan.walls, { snap: snapRef.current })
      const a = px(anchor), b = px(s)
      ctx.setLineDash([6, 4]); ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      ctx.setLineDash([])
      // live length and angle while chaining
      const L = Math.hypot(s.x - anchor.x, s.y - anchor.y)
      const deg = ((Math.atan2(s.y - anchor.y, s.x - anchor.x) * 180) / Math.PI + 360) % 360
      ctx.fillStyle = '#e8e8ea'
      ctx.font = '500 11px Inter, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`${L.toFixed(2)} m · ${deg.toFixed(0)}°`, b.x + 10, b.y - 8)
      // closing the loop: highlight the first corner when the cursor is on it
      const start = plan.chain.points[0]!
      if (plan.chain.points.length >= 2 && Math.hypot(s.x - start.x, s.y - start.y) < DEFAULTS.vertexSnap) {
        const p0 = px(start)
        ctx.strokeStyle = '#3b82f6'
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(p0.x, p0.y, 9, 0, 7); ctx.stroke()
      }
    }

    const drag = dragRef.current
    if (drag?.kind === 'stamp') {
      const a = px(drag.from), b = px(snapPoint(mouseRef.current, null, [], { snap: snapRef.current }))
      ctx.setLineDash([6, 4]); ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(59,130,246,0.08)'
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
      // live dimensions during the drag
      const wM = Math.abs(mouseRef.current.x - drag.from.x)
      const hM = Math.abs(mouseRef.current.y - drag.from.y)
      ctx.fillStyle = '#e8e8ea'
      ctx.font = '500 11px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`${wM.toFixed(2)} × ${hM.toFixed(2)} m`, (a.x + b.x) / 2, Math.min(a.y, b.y) - 8)
    }
    ctx.restore()
  })

  // ---- input -------------------------------------------------------------
  const onPointerMove = useCallback(
    (ev: React.PointerEvent) => {
      const p = toWorld(ev)
      mouseRef.current = p
      const { plan, tool } = live()
      const drag = dragRef.current
      if (drag?.kind === 'pan') {
        setView((v) => ({ ...v, x: v.x + ev.movementX, y: v.y + ev.movementY }))
        return
      }
      if (drag?.kind === 'vertex') {
        const s = snapPoint(p, null, [], { snap: snapRef.current })
        if (pointKey(s) === drag.key) return
        if (!drag.started) { planActions.beginEdit(plan); drag.started = true }
        planActions.moveVertex(plan, drag.key, s)
        drag.key = pointKey(s)
        if (live().sel?.kind === 'vertex') setSel({ kind: 'vertex', key: drag.key })
        redraw()
        return
      }
      if (drag?.kind === 'wall') {
        const d = { x: p.x - drag.last.x, y: p.y - drag.last.y }
        if (Math.hypot(d.x, d.y) > DEFAULTS.grid / 2) {
          if (!drag.started) { planActions.beginEdit(plan); drag.started = true }
          planActions.moveWall(plan, drag.id, d, { snap: snapRef.current })
          drag.last = p
          redraw()
        }
        return
      }
      if (drag?.kind === 'opening') {
        const host = nearestWall(plan.walls, p, 0.8)
        const o = plan.openings.find((x) => x.id === drag.id)
        if (host && !drag.started) { planActions.beginEdit(plan); drag.started = true }
        if (host && o && host.wall.id !== o.wallId) planActions.rehostOpening(plan, drag.id, host.wall.id, host.along)
        else if (host) planActions.moveOpening(plan, drag.id, host.along)
        redraw()
        return
      }
      // hover feedback for the opening tools
      if (tool === 'door' || tool === 'window') {
        const h = nearestWall(plan.walls, p, 14 / viewRef.current.scale)
        hoverRef.current = h ? openingPlacement(plan, h.wall.id, h.along, tool, openingSide.current) : null
      } else {
        hoverRef.current = null
      }
      redraw()
    },
    [toWorld, redraw, setSel],
  )

  const onPointerDown = useCallback(
    (ev: React.PointerEvent) => {
      canvasRef.current?.setPointerCapture(ev.pointerId)
      const p = toWorld(ev)
      mouseRef.current = p
      const { plan, tool } = live()
      if (ev.button === 1 || spaceRef.current) {
        dragRef.current = { kind: 'pan' }
        return
      }
      if (ev.button === 2) {
        planActions.endChain(plan)
        redraw()
        return
      }
      if (tool === 'wall') {
        planActions.chainClick(plan, p, { snap: snapRef.current })
        redraw()
        return
      }
      if (tool === 'room') {
        dragRef.current = { kind: 'stamp', from: snapPoint(p, null, [], { snap: snapRef.current }) }
        return
      }
      if (tool === 'door' || tool === 'window') {
        // Resolve the actual click, including touch input with no preceding hover event.
        const hit = nearestWall(plan.walls, p, 14 / viewRef.current.scale)
        if (hit) {
          const previousCount = plan.openings.length
          planActions.placeOpening(plan, hit.wall.id, hit.along, tool, openingSide.current)
          if (plan.openings.length > previousCount) {
            setSel({ kind: 'opening', id: plan.openings[plan.openings.length - 1]!.id })
            setTool('select')
            hoverRef.current = null
          }
        } else {
          plan.note = 'Click directly on a wall to place a door or window.'
        }
        redraw()
        return
      }
      const hit = hitTest(plan, p)
      if (!hit) {
        setSel(null)
        redraw()
        return
      }
      if (hit.kind === 'vertex') {
        setSel({ kind: 'vertex', key: hit.vertex.key })
        dragRef.current = { kind: 'vertex', key: hit.vertex.key }
      } else if (hit.kind === 'wall') {
        setSel({ kind: 'wall', id: hit.wall.id })
        dragRef.current = { kind: 'wall', id: hit.wall.id, last: p }
      } else if (hit.kind === 'opening') {
        setSel({ kind: 'opening', id: hit.opening.id })
        dragRef.current = { kind: 'opening', id: hit.opening.id }
      }
      redraw()
    },
    [toWorld, redraw, setSel, setTool],
  )

  const onPointerUp = useCallback(
    (ev: React.PointerEvent) => {
      const { plan } = live()
      const drag = dragRef.current
      if (drag?.kind === 'stamp') {
        planActions.stampRectangle(plan, drag.from, toWorld(ev))
      }
      dragRef.current = null
      redraw()
    },
    [toWorld, redraw],
  )

  const onWheel = useCallback(
    (ev: React.WheelEvent) => {
      const before = toWorld(ev)
      setView((v) => {
        const scale = Math.max(14, Math.min(180, v.scale * (ev.deltaY < 0 ? 1.12 : 0.89)))
        const r = canvasRef.current!.getBoundingClientRect()
        const after = { x: (ev.clientX - r.left - v.x) / scale, y: (ev.clientY - r.top - v.y) / scale }
        return { scale, x: v.x + (after.x - before.x) * scale, y: v.y + (after.y - before.y) * scale }
      })
    },
    [toWorld],
  )

  /** Fit the whole plan in both views (FR-025): the 2D canvas here, the 3D
   *  preview via the nonce it watches. */
  const fitView = useCallback(() => {
    const { plan } = live()
    const c = canvasRef.current
    usePlanEditorStore.getState().requestFit()
    if (!c) return
    if (!plan.walls.length) {
      setView({ x: c.clientWidth / 2, y: c.clientHeight / 2, scale: 52 })
      return
    }
    const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x])
    const ys = plan.walls.flatMap((w) => [w.a.y, w.b.y])
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const pad = 90
    const sx = (c.clientWidth - pad * 2) / Math.max(0.5, maxX - minX)
    const sy = (c.clientHeight - pad * 2) / Math.max(0.5, maxY - minY)
    const scale = Math.max(14, Math.min(160, Math.min(sx, sy)))
    setView({ scale, x: c.clientWidth / 2 - ((minX + maxX) / 2) * scale, y: c.clientHeight / 2 - ((minY + maxY) / 2) * scale })
  }, [])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
      if (ev.code === 'Space') { spaceRef.current = true; ev.preventDefault(); return }
      const { plan } = live()
      const k = ev.key.toLowerCase()
      if ((ev.metaKey || ev.ctrlKey) && k === 'z') {
        ev.preventDefault()
        if (ev.shiftKey) planActions.redoAction(plan)
        else planActions.undo(plan)
        setSel(null)
        redraw()
        return
      }
      if (k === 'v') setTool('select')
      if (k === 'w') setTool('wall')
      if (k === 'r') setTool('room')
      if (k === 'd') setTool('door')
      if (k === 'n') setTool('window')
      if (k === 'g') setSnapOn((s) => !s)
      if (k === '0') { fitView(); plan.note = 'Framed the plan.'; redraw() }
      if (ev.key === 'Escape') { planActions.endChain(plan); setSel(null); setTool('select'); redraw() }
      const cur = live().sel
      if (k === 'f' && live().tool === 'door') {
        openingSide.current = openingSide.current === 1 ? -1 : 1
        const preview = hoverRef.current
        if (preview) preview.opening.side = openingSide.current
        redraw()
        return
      }
      if (k === 'f' && cur?.kind === 'opening' && plan.openings.find((o) => o.id === cur.id)?.kind === 'door') {
        planActions.flipOpening(plan, cur.id)
        redraw()
        return
      }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && cur) {
        if (cur.kind === 'vertex') planActions.removeVertex(plan, cur.key)
        else planActions.remove(plan, cur.id)
        setSel(null)
        redraw()
      }
    }
    const onUp = (ev: KeyboardEvent) => { if (ev.code === 'Space') spaceRef.current = false }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp) }
  }, [setTool, setSel, redraw, fitView])

  useEffect(() => {
    fitView()
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fitView)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [assetId, fitView])

  const rooms = planRooms(plan.walls)
  const totalArea = rooms.reduce((s, r) => s + r.area, 0)

  return (
    <main className="flex h-full flex-col bg-[#0f0f11] text-ink">
      <header className="flex items-center justify-between border-b border-line/60 px-5 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void leavePlan()}
            className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink"
          >
            ← Library
          </button>
          <input
            key={assetId}
            defaultValue={asset?.name ?? 'Untitled plan'}
            onBlur={(e) => { const name = e.target.value.trim() || asset?.name || 'Untitled plan'; e.target.value = name; void renameActivePlan(name) }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="rounded-md border border-transparent bg-transparent px-2 py-1 text-[15px] font-medium text-ink focus:border-line focus:bg-panel focus:outline-none"
            aria-label="Plan name"
          />
        </div>
        <div className="flex items-center gap-2">
          <span role="status" className="text-xs text-ink-dim">{saveMessage}</span>
          <button
            type="button"
            onClick={() => void save()}
            className="ml-2 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            Save
          </button>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <div className="grid h-full grid-cols-1 grid-rows-2 lg:grid-cols-[3fr_2fr] lg:grid-rows-1">
          <section aria-label="2D floor plan editor" className="flex min-h-0 min-w-0 flex-col border-r border-line/60">
            <p className="border-b border-line px-3 py-2 text-xs text-ink-dim">{tool === 'select' ? 'Select a corner, opening or wall. Drag to move · Delete to remove.' : tool === 'room' ? 'Drag to draw a room.' : tool === 'wall' ? 'Click to chain walls · Escape to finish.' : 'Click a wall to place · F flips a door · Returns to Select.'} Space + drag to pan · Scroll to zoom.</p>
            <div className="flex min-h-0 flex-1">
            <PlanToolbar tool={tool} setTool={(next) => { hoverRef.current = null; setTool(next) }} snap={snapOn}
              toggleSnap={() => setSnapOn((value) => !value)} fit={fitView}
              canUndo={!!plan.undo.length} canRedo={!!plan.redo.length}
              undo={() => { planActions.undo(live().plan); setSel(null); redraw() }}
              redo={() => { planActions.redoAction(live().plan); setSel(null); redraw() }} />
            <div className="relative min-w-0 flex-1">

            <canvas
              ref={canvasRef}
              aria-label="2D floor plan"
              className={`block h-full w-full touch-none ${tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
              onPointerMove={onPointerMove}
              onPointerLeave={() => { hoverRef.current = null; redraw() }}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onWheel={onWheel}
              onContextMenu={(e) => e.preventDefault()}
            />
            <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-lg border border-line bg-panel px-3 py-1.5 text-[11px] text-ink-dim">
              Walls {plan.walls.length} · Openings {plan.openings.length} · Rooms {rooms.length} · {totalArea.toFixed(1)} m²
            </div>

            </div>
            <PlanInspector />
            </div>
            <div role="status" className="border-t border-line px-3 py-2 text-xs text-ink-dim">{(tool === 'door' || tool === 'window') && hoverRef.current?.opening.kind === tool ? hoverRef.current.issue ?? `${tool === 'door' ? 'Door' : 'Window'} · ${hoverRef.current.opening.width.toFixed(2)} × ${hoverRef.current.opening.height.toFixed(2)} m · Click to place` : note}</div>
          </section>
          <div className="relative min-h-0">
            <PlanPreview3D plan={plan} fitNonce={fitNonce} />
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-line bg-panel px-3 py-1.5 text-[11px] text-ink-dim shadow-[0_8px_24px_rgb(0_0_0/0.28)]">
              3D preview
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
