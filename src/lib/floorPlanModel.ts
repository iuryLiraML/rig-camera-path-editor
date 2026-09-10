/**
 * The floor-plan model: a pure, DOM-free description of a plan and every
 * geometric question the editor, the preview, and scene insertion ask of it.
 *
 * A plan is walls and openings, nothing else. Walls are straight segments
 * between shared corners; openings are doors or windows hosted on exactly one
 * wall. Rooms and their areas are derived from the wall graph on demand and
 * are never stored — that is what keeps a plan re-editable without a second
 * representation to drift apart (ADR 0003).
 *
 * Metres throughout. No three.js, no zustand, no DOM: every test here runs
 * without a browser, per FR-014.
 */

export type PlanPoint = { x: number; y: number }

export type PlanWall = {
  id: string
  a: PlanPoint
  b: PlanPoint
  thickness: number
  height: number
}

export type PlanOpeningKind = 'door' | 'window'

export type PlanOpening = {
  id: string
  wallId: string
  kind: PlanOpeningKind
  /** Distance of the opening's centre from wall.a, along the wall. */
  along: number
  width: number
  height: number
  /** Height of the opening's base above the floor. 0 for a door. */
  sill: number
  /** Which way a door swings. */
  side: 1 | -1
}

export type PlanRoom = {
  points: PlanPoint[]
  area: number
  center: PlanPoint
}

/** One solid piece of an extruded wall: a box from `from` to `to` along the wall, `y0` to `y1` up. */
export type PlanPiece = {
  wall: PlanWall
  from: number
  to: number
  y0: number
  y1: number
}

export type PlanState = {
  walls: PlanWall[]
  openings: PlanOpening[]
  /** The in-progress chain, or null when no chain is open. */
  chain: { points: PlanPoint[] } | null
  undo: string[]
  redo: string[]
  /** The last thing the model did or refused, in product language. */
  note: string
  /** Id counter lives on the state, not the module — the module stays pure. */
  nextId: number
  /** Bumped by every mutation, so a subscriber can tell the plan changed even
   *  though actions mutate in place and the reference never changes. */
  version: number
}

export const DEFAULTS = {
  wallHeight: 2.4,
  wallThickness: 0.1,
  grid: 0.25,
  angleSnapDeg: 12,
  vertexSnap: 0.3,
} as const

export const OPENING_SPEC: Record<PlanOpeningKind, { width: number; height: number; sill: number }> = {
  door: { width: 0.9, height: 2.1, sill: 0 },
  window: { width: 1.2, height: 1.0, sill: 0.9 },
}

const makeId = (state: PlanState, prefix: string) => `${prefix}${state.nextId++}`

/** The identity of a corner, so every wall endpoint at one position shares it. */
export const pointKey = (p: PlanPoint): string => `${p.x.toFixed(3)},${p.y.toFixed(3)}`

const dist = (a: PlanPoint, b: PlanPoint): number => Math.hypot(a.x - b.x, a.y - b.y)
export const wallLength = (w: PlanWall): number => dist(w.a, w.b)
const snapGrid = (v: number, g: number = DEFAULTS.grid): number => Math.round(v / g) * g

export function createPlan(): PlanState {
  return { walls: [], openings: [], chain: null, undo: [], redo: [], note: 'Empty plan.', nextId: 1, version: 0 }
}

/** Every mutating action ends here, so a stable reference still broadcasts change. */
function touch(s: PlanState): void {
  s.version++
}

// ---------------------------------------------------------------------------
// Undo — snapshot-based, one step per edit. A drag calls beginEdit once.
// ---------------------------------------------------------------------------

const snapshot = (s: PlanState): string => JSON.stringify({ walls: s.walls, openings: s.openings })

function pushUndo(s: PlanState): void {
  s.undo.push(snapshot(s))
  if (s.undo.length > 60) s.undo.shift()
  s.redo.length = 0
  touch(s)
}

function restore(s: PlanState, snap: string): void {
  const parsed = JSON.parse(snap) as { walls: PlanWall[]; openings: PlanOpening[] }
  s.walls = parsed.walls
  s.openings = parsed.openings
  s.chain = null
  touch(s)
}

// ---------------------------------------------------------------------------
// Snapping — grid, then a 45° pull from the chain anchor, then existing corners.
// ---------------------------------------------------------------------------

export function snapPoint(
  p: PlanPoint,
  anchor: PlanPoint | null,
  walls: PlanWall[],
  opts: { snap?: boolean } = {},
): PlanPoint & { snapped?: 'vertex' } {
  const grid = opts.snap === false ? 0.001 : DEFAULTS.grid
  let s: PlanPoint = { x: snapGrid(p.x, grid), y: snapGrid(p.y, grid) }
  if (anchor && opts.snap !== false) {
    const dx = s.x - anchor.x
    const dy = s.y - anchor.y
    const ang = Math.atan2(dy, dx)
    const quant = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4)
    if (Math.abs(ang - quant) < (DEFAULTS.angleSnapDeg * Math.PI) / 180) {
      const L = Math.hypot(dx, dy)
      s = { x: snapGrid(anchor.x + L * Math.cos(quant), grid), y: snapGrid(anchor.y + L * Math.sin(quant), grid) }
    }
  }
  for (const w of walls) {
    for (const e of [w.a, w.b]) {
      if (dist(s, e) < DEFAULTS.vertexSnap) return { x: e.x, y: e.y, snapped: 'vertex' }
    }
  }
  return s
}

const makeWall = (state: PlanState, a: PlanPoint, b: PlanPoint): PlanWall => ({
  id: makeId(state, 'w'),
  a: { ...a },
  b: { ...b },
  thickness: DEFAULTS.wallThickness,
  height: DEFAULTS.wallHeight,
})

// ---------------------------------------------------------------------------
// Projection and hit-testing
// ---------------------------------------------------------------------------

export function projectToWall(wall: PlanWall, p: PlanPoint) {
  const vx = wall.b.x - wall.a.x
  const vy = wall.b.y - wall.a.y
  const L2 = vx * vx + vy * vy || 1e-9
  const t = Math.max(0, Math.min(1, ((p.x - wall.a.x) * vx + (p.y - wall.a.y) * vy) / L2))
  const cx = wall.a.x + t * vx
  const cy = wall.a.y + t * vy
  const side = (Math.sign(vx * (p.y - wall.a.y) - vy * (p.x - wall.a.x)) || 1) as 1 | -1
  return { t, along: t * Math.sqrt(L2), side, cx, cy, dist: Math.hypot(p.x - cx, p.y - cy) }
}

export function nearestWall(walls: PlanWall[], p: PlanPoint, maxDist = 0.5) {
  let best: ({ wall: PlanWall } & ReturnType<typeof projectToWall>) | null = null
  for (const w of walls) {
    const pr = projectToWall(w, p)
    if (pr.dist < maxDist && (!best || pr.dist < best.dist)) best = { wall: w, ...pr }
  }
  return best
}

/** Every distinct corner, with how many wall endpoints meet there. */
export function planVertices(walls: PlanWall[]) {
  const map = new Map<string, PlanPoint & { key: string; count: number }>()
  for (const w of walls) {
    for (const e of [w.a, w.b]) {
      const k = pointKey(e)
      if (!map.has(k)) map.set(k, { x: e.x, y: e.y, key: k, count: 0 })
      map.get(k)!.count++
    }
  }
  return [...map.values()]
}

export function nearestVertex(walls: PlanWall[], p: PlanPoint, maxDist = 0.28) {
  let best: { vertex: ReturnType<typeof planVertices>[number]; d: number } | null = null
  for (const v of planVertices(walls)) {
    const d = dist(v, p)
    if (d < maxDist && (!best || d < best.d)) best = { vertex: v, d }
  }
  return best
}

export function openingCenter(state: PlanState, o: PlanOpening) {
  const w = state.walls.find((x) => x.id === o.wallId)
  if (!w) return null
  const L = wallLength(w) || 1e-9
  const ux = (w.b.x - w.a.x) / L
  const uy = (w.b.y - w.a.y) / L
  return { x: w.a.x + ux * o.along, y: w.a.y + uy * o.along, ux, uy, wall: w, L }
}

/** The unit vector along a wall, so callers stop re-deriving it from endpoints. */
export function wallBasis(w: PlanWall): { ux: number; uy: number; L: number } {
  const L = wallLength(w) || 1e-9
  return { ux: (w.b.x - w.a.x) / L, uy: (w.b.y - w.a.y) / L, L }
}

/** The two endpoints of an opening's span on its host wall, in world space. */
export function openingEndpoints(wall: PlanWall, along: number, width: number): { p1: PlanPoint; p2: PlanPoint } {
  const { ux, uy } = wallBasis(wall)
  const half = width / 2
  const cx = wall.a.x + ux * along
  const cy = wall.a.y + uy * along
  return {
    p1: { x: cx - ux * half, y: cy - uy * half },
    p2: { x: cx + ux * half, y: cy + uy * half },
  }
}

/** Shared validation for the placement ghost, insertion, inspector and dragging. */
export function openingIssue(state: PlanState, opening: PlanOpening): string | null {
  const wall = state.walls.find((w) => w.id === opening.wallId)
  if (!wall) return 'Choose a wall for this opening.'
  if (![opening.width, opening.height, opening.sill, opening.along].every(Number.isFinite)
    || opening.width <= 0 || opening.height <= 0 || opening.sill < 0) return 'Enter valid opening dimensions.'
  const length = wallLength(wall)
  if (opening.width > length + 1e-6) return `This ${opening.kind} needs ${opening.width.toFixed(2)} m of wall.`
  if (opening.sill + opening.height > wall.height + 1e-6) return 'The opening is too tall for this wall. Reduce its height or sill.'
  if (opening.along - opening.width / 2 < -1e-6 || opening.along + opening.width / 2 > length + 1e-6) return 'Keep the opening inside the wall ends.'
  if (state.openings.some((other) => other.id !== opening.id && other.wallId === opening.wallId
    && Math.abs(other.along - opening.along) < (other.width + opening.width) / 2 - 1e-6)) {
    return 'This overlaps another opening. Choose a free part of the wall.'
  }
  return null
}

export function openingPlacement(state: PlanState, wallId: string, along: number, kind: PlanOpeningKind, side: 1 | -1 = 1) {
  const spec = OPENING_SPEC[kind]
  const wall = state.walls.find((w) => w.id === wallId)
  const length = wall ? wallLength(wall) : 0
  const opening: PlanOpening = {
    id: '', wallId, kind, side, ...spec,
    along: Math.max(spec.width / 2, Math.min(length - spec.width / 2, along)),
  }
  return { opening, issue: openingIssue(state, opening) }
}

export function nearestOpening(state: PlanState, p: PlanPoint, maxDist = 0.3) {
  let best: { opening: PlanOpening; d: number } | null = null
  for (const o of state.openings) {
    const c = openingCenter(state, o)
    if (!c) continue
    const d = dist(c, p)
    if (d < Math.max(maxDist, o.width / 2) && (!best || d < best.d)) best = { opening: o, d }
  }
  return best
}

/** Smallest target wins: a corner is never stolen by the wall it sits on. */
export function hitTest(state: PlanState, p: PlanPoint) {
  const v = nearestVertex(state.walls, p)
  if (v) return { kind: 'vertex' as const, vertex: v.vertex }
  const o = nearestOpening(state, p)
  if (o) return { kind: 'opening' as const, opening: o.opening }
  const w = nearestWall(state.walls, p)
  if (w) return { kind: 'wall' as const, wall: w.wall, along: w.along }
  return null
}

// ---------------------------------------------------------------------------
// Rooms — derived by planar face traversal, never stored (FR-010)
// ---------------------------------------------------------------------------

export function planRooms(walls: PlanWall[]): PlanRoom[] {
  const adj = new Map<string, { point: PlanPoint; out: PlanPoint[] }>()
  const add = (from: PlanPoint, to: PlanPoint) => {
    const k = pointKey(from)
    if (!adj.has(k)) adj.set(k, { point: from, out: [] })
    adj.get(k)!.out.push(to)
  }
  for (const w of walls) {
    add(w.a, w.b)
    add(w.b, w.a)
  }
  const seen = new Set<string>()
  const faces: PlanRoom[] = []
  for (const [k, node] of adj) {
    for (const next of node.out) {
      const ek = `${k}>${pointKey(next)}`
      if (seen.has(ek)) continue
      const loop: PlanPoint[] = []
      let cur = node.point
      let nxt = next
      let guard = 0
      while (guard++ < 400) {
        seen.add(`${pointKey(cur)}>${pointKey(nxt)}`)
        loop.push(cur)
        const node2 = adj.get(pointKey(nxt))
        if (!node2) break
        const back = Math.atan2(cur.y - nxt.y, cur.x - nxt.x)
        // The most clockwise turn keeps the interior face on the same side.
        let pick: PlanPoint | null = null
        let bestAng = Infinity
        for (const cand of node2.out) {
          if (pointKey(cand) === pointKey(cur) && node2.out.length > 1) continue
          let a = back - Math.atan2(cand.y - nxt.y, cand.x - nxt.x)
          while (a <= 0) a += Math.PI * 2
          while (a > Math.PI * 2) a -= Math.PI * 2
          if (a < bestAng) {
            bestAng = a
            pick = cand
          }
        }
        if (!pick) break
        cur = nxt
        nxt = pick
        if (pointKey(cur) === k && pointKey(nxt) === pointKey(next)) break
      }
      if (loop.length >= 3) {
        let area = 0
        for (let i = 0; i < loop.length; i++) {
          const p1 = loop[i]!
          const p2 = loop[(i + 1) % loop.length]!
          area += p1.x * p2.y - p2.x * p1.y
        }
        area /= 2
        if (area > 0.05) {
          const cx = loop.reduce((s, p) => s + p.x, 0) / loop.length
          const cy = loop.reduce((s, p) => s + p.y, 0) / loop.length
          faces.push({ points: loop, area, center: { x: cx, y: cy } })
        }
      }
    }
  }
  return faces
}

/** Total enclosed area across every derived room. */
export function planArea(walls: PlanWall[]): number {
  return planRooms(walls).reduce((s, r) => s + r.area, 0)
}

// ---------------------------------------------------------------------------
// Extrusion — solid pieces around each opening, no boolean ops (FR-031)
// ---------------------------------------------------------------------------

export function planExtrude(state: PlanState): PlanPiece[] {
  const pieces: PlanPiece[] = []
  for (const w of state.walls) {
    const hosted = state.openings.filter((o) => o.wallId === w.id).sort((a, b) => a.along - b.along)
    const L = wallLength(w)
    let cursor = 0
    const push = (from: number, to: number, y0: number, y1: number) => {
      if (to - from > 1e-4 && y1 - y0 > 1e-4) pieces.push({ wall: w, from, to, y0, y1 })
    }
    for (const o of hosted) {
      const a = o.along - o.width / 2
      const b = o.along + o.width / 2
      push(cursor, a, 0, w.height)
      push(a, b, o.sill + o.height, w.height)
      if (o.sill > 0) push(a, b, 0, o.sill)
      cursor = b
    }
    push(cursor, L, 0, w.height)
  }
  return pieces
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * A T-junction only encloses a room if the host wall becomes two walls sharing
 * the new corner. Without this an interior wall is a dangling edge and room
 * detection still sees one room — the prototype's first bug.
 */
export function splitWallAt(state: PlanState, point: PlanPoint): boolean {
  const hit = nearestWall(state.walls, point, 0.12)
  if (!hit) return false
  const w = hit.wall
  const L = wallLength(w)
  if (hit.along < 0.05 || hit.along > L - 0.05) return false // an endpoint, not a split
  const first: PlanWall = { ...makeWall(state, w.a, point), thickness: w.thickness, height: w.height }
  const second: PlanWall = { ...makeWall(state, point, w.b), thickness: w.thickness, height: w.height }
  state.walls.splice(state.walls.indexOf(w), 1, first, second)
  for (const o of state.openings) {
    if (o.wallId !== w.id) continue
    if (o.along <= hit.along) o.wallId = first.id
    else {
      o.wallId = second.id
      o.along -= hit.along
    }
  }
  return true
}

export const planActions = {
  /** Call once at drag start so a whole drag is a single undo step. */
  beginEdit(state: PlanState) {
    pushUndo(state)
    return state
  },

  chainClick(state: PlanState, point: PlanPoint, opts: { snap?: boolean } = {}) {
    const anchor = state.chain ? state.chain.points[state.chain.points.length - 1]! : null
    const s = snapPoint(point, anchor, state.walls, opts)
    if (!state.chain) {
      pushUndo(state)
      const split = splitWallAt(state, s)
      state.chain = { points: [s] }
      state.note = split
        ? 'Chain started on a wall — the wall split at that corner.'
        : 'Chain started. Click the first corner again to close.'
      return state
    }
    const start = state.chain.points[0]!
    if (state.chain.points.length >= 2 && dist(s, start) < DEFAULTS.vertexSnap) {
      pushUndo(state)
      state.walls.push(makeWall(state, anchor!, start))
      state.note = 'Loop closed — room enclosed.'
      state.chain = null
      return state
    }
    pushUndo(state)
    const split = splitWallAt(state, s)
    state.chain.points.push(s)
    state.walls.push(makeWall(state, anchor!, s))
    const last = state.walls[state.walls.length - 1]!
    state.note = `Wall ${wallLength(last).toFixed(2)} m placed${split ? ', host wall split' : ''}.`
    return state
  },

  endChain(state: PlanState) {
    if (state.chain) {
      state.chain = null
      state.note = 'Chain ended (walls stay).'
    }
    return state
  },

  stampRectangle(state: PlanState, c1: PlanPoint, c2: PlanPoint) {
    const x1 = snapGrid(Math.min(c1.x, c2.x))
    const x2 = snapGrid(Math.max(c1.x, c2.x))
    const y1 = snapGrid(Math.min(c1.y, c2.y))
    const y2 = snapGrid(Math.max(c1.y, c2.y))
    if (x2 - x1 < DEFAULTS.grid || y2 - y1 < DEFAULTS.grid) {
      state.note = 'Rectangle too small — nothing stamped.'
      return state
    }
    pushUndo(state)
    const c: PlanPoint[] = [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ]
    for (let i = 0; i < 4; i++) state.walls.push(makeWall(state, c[i]!, c[(i + 1) % 4]!))
    state.note = `Room stamped ${(x2 - x1).toFixed(2)} × ${(y2 - y1).toFixed(2)} m — ${((x2 - x1) * (y2 - y1)).toFixed(1)} m².`
    return state
  },

  placeOpening(state: PlanState, wallId: string, along: number, kind: PlanOpeningKind, side: 1 | -1 = 1) {
    const { opening, issue } = openingPlacement(state, wallId, along, kind, side)
    if (issue) { state.note = issue; return state }
    pushUndo(state)
    const o = { ...opening, id: makeId(state, 'o') }

    state.openings.push(o)
    state.note = `${kind === 'door' ? 'Door' : 'Window'} hosted ${o.along.toFixed(2)} m along the wall.`
    return state
  },

  /** Drag an opening along its host wall; clamped so it never overhangs. */
  moveOpening(state: PlanState, openingId: string, along: number) {
    const o = state.openings.find((x) => x.id === openingId)
    if (!o) return state
    const w = state.walls.find((x) => x.id === o.wallId)
    if (!w) return state
    const L = wallLength(w)
    const candidate = { ...o, along: Math.max(o.width / 2, Math.min(L - o.width / 2, along)) }
    const issue = openingIssue(state, candidate)
    if (issue) { state.note = issue; return state }
    o.along = candidate.along
    state.note = `${o.kind} at ${o.along.toFixed(2)} m.`
    touch(state)
    return state
  },

  /** Rehost an opening onto a different wall (drag it across). */
  rehostOpening(state: PlanState, openingId: string, wallId: string, along: number) {
    const o = state.openings.find((x) => x.id === openingId)
    const w = state.walls.find((x) => x.id === wallId)
    if (!o || !w) return state
    const candidate = { ...o, wallId, along: Math.max(o.width / 2, Math.min(wallLength(w) - o.width / 2, along)) }
    const issue = openingIssue(state, candidate)
    if (issue) { state.note = issue; return state }
    Object.assign(o, candidate)
    state.note = `${o.kind === 'door' ? 'Door' : 'Window'} moved to another wall.`
    touch(state)
    return state
  },

  /** Move a shared corner: every wall endpoint at that spot follows (FR-009).
   *  A wall collapsed to zero length is dropped, with its hosted openings. */
  moveVertex(state: PlanState, fromKey: string, to: PlanPoint) {
    for (const w of state.walls) {
      if (pointKey(w.a) === fromKey) w.a = { x: to.x, y: to.y }
      if (pointKey(w.b) === fromKey) w.b = { x: to.x, y: to.y }
    }
    // Drop degenerate walls rather than keeping a zero-length segment.
    const degenerate = new Set(state.walls.filter((w) => wallLength(w) < 0.01).map((w) => w.id))
    if (degenerate.size) {
      state.walls = state.walls.filter((w) => !degenerate.has(w.id))
      state.openings = state.openings.filter((o) => !degenerate.has(o.wallId))
      state.note = 'Wall collapsed to nothing — dropped.'
    }
    // Openings clamp back inside their now-shorter or longer walls.
    for (const o of state.openings) {
      const w = state.walls.find((x) => x.id === o.wallId)
      if (!w) continue
      const L = wallLength(w)
      const half = Math.min(o.width, L) / 2
      o.width = Math.min(o.width, L)
      o.along = Math.max(half, Math.min(L - half, o.along))
    }
    touch(state)
    return state
  },

  moveWall(state: PlanState, wallId: string, delta: PlanPoint, opts: { snap?: boolean } = {}) {
    const w = state.walls.find((x) => x.id === wallId)
    if (!w) return state
    const snap = opts.snap !== false
    const ka = pointKey(w.a)
    const kb = pointKey(w.b)
    const na = { x: w.a.x + delta.x, y: w.a.y + delta.y }
    const nb = { x: w.b.x + delta.x, y: w.b.y + delta.y }
    planActions.moveVertex(state, ka, snap ? { x: snapGrid(na.x), y: snapGrid(na.y) } : na)
    planActions.moveVertex(state, kb, snap ? { x: snapGrid(nb.x), y: snapGrid(nb.y) } : nb)
    return state
  },

  flipOpening(state: PlanState, openingId: string) {
    const o = state.openings.find((x) => x.id === openingId)
    if (o) {
      pushUndo(state)
      o.side = o.side === 1 ? -1 : 1
      state.note = 'Opening flipped.'
    }
    return state
  },

  setOpening(state: PlanState, openingId: string, patch: Partial<Pick<PlanOpening, 'width' | 'height' | 'sill' | 'kind'>>) {
    const o = state.openings.find((x) => x.id === openingId)
    if (!o) return state
    const candidate = { ...o, ...patch }
    const issue = openingIssue(state, candidate)
    if (issue) { state.note = issue; return state }
    pushUndo(state)
    Object.assign(o, candidate)
    state.note = 'Opening updated.'
    return state
  },

  setWall(state: PlanState, wallId: string, patch: Partial<Pick<PlanWall, 'height' | 'thickness'>>) {
    const w = state.walls.find((x) => x.id === wallId)
    if (!w) return state
    if (patch.height !== undefined && state.openings.some((o) => o.wallId === wallId && o.sill + o.height > patch.height!)) {
      state.note = 'Wall height must fit its doors and windows.'
      return state
    }
    pushUndo(state)
    Object.assign(w, patch)
    state.note = 'Wall updated.'
    return state
  },

  setAllWalls(state: PlanState, patch: Partial<Pick<PlanWall, 'height' | 'thickness'>>) {
    if (patch.height !== undefined && state.openings.some((o) => o.sill + o.height > patch.height!)) {
      state.note = 'Wall height must fit its doors and windows.'
      return state
    }
    pushUndo(state)
    for (const w of state.walls) Object.assign(w, patch)
    state.note = 'All walls updated.'
    return state
  },

  remove(state: PlanState, targetId: string) {
    const wi = state.walls.findIndex((w) => w.id === targetId)
    if (wi >= 0) {
      pushUndo(state)
      const lost = state.openings.filter((o) => o.wallId === targetId).length
      state.walls.splice(wi, 1)
      state.openings = state.openings.filter((o) => o.wallId !== targetId)
      state.note = `Wall deleted${lost ? ` — ${lost} opening(s) went with it` : ''}.`
      return state
    }
    const oi = state.openings.findIndex((o) => o.id === targetId)
    if (oi >= 0) {
      pushUndo(state)
      state.openings.splice(oi, 1)
      state.note = 'Opening deleted.'
    }
    return state
  },

  removeVertex(state: PlanState, vertexKey: string) {
    pushUndo(state)
    const doomed = state.walls.filter((w) => pointKey(w.a) === vertexKey || pointKey(w.b) === vertexKey)
    const ids = new Set(doomed.map((w) => w.id))
    state.walls = state.walls.filter((w) => !ids.has(w.id))
    state.openings = state.openings.filter((o) => !ids.has(o.wallId))
    state.note = `Corner removed — ${doomed.length} wall(s) with it.`
    return state
  },

  undo(state: PlanState) {
    const snap = state.undo.pop()
    if (!snap) {
      state.note = 'Nothing to undo.'
      return state
    }
    state.redo.push(snapshot(state))
    restore(state, snap)
    state.note = 'Undone.'
    return state
  },

  redoAction(state: PlanState) {
    const snap = state.redo.pop()
    if (!snap) {
      state.note = 'Nothing to redo.'
      return state
    }
    state.undo.push(snapshot(state))
    restore(state, snap)
    state.note = 'Redone.'
    return state
  },

  clear(state: PlanState) {
    pushUndo(state)
    state.walls = []
    state.openings = []
    state.chain = null
    state.note = 'Plan cleared.'
    return state
  },
}

// ---------------------------------------------------------------------------
// Serialization — what a Plan asset stores, and what an inserted object copies.
// ---------------------------------------------------------------------------

export type PlanJSON = {
  unit: 'm'
  walls: { id: string; a: [number, number]; b: [number, number]; thickness: number; height: number }[]
  openings: { id: string; wallId: string; kind: PlanOpeningKind; along: number; width: number; height: number; sill: number; side: 1 | -1 }[]
}

/** The stored graph as it sits on records — pre-validation, so unknown[]. One
 *  type for every signature that accepts it, instead of six anonymous copies. */
export type StoredPlan = { walls: unknown[]; openings: unknown[] }

/** What a Plan asset stores: walls and openings, nothing derived. */
export function planToJSON(state: PlanState): PlanJSON {
  return {
    unit: 'm',
    walls: state.walls.map((w) => ({
      id: w.id,
      a: [+w.a.x.toFixed(3), +w.a.y.toFixed(3)],
      b: [+w.b.x.toFixed(3), +w.b.y.toFixed(3)],
      thickness: w.thickness,
      height: w.height,
    })),
    openings: state.openings.map((o) => ({
      id: o.id,
      wallId: o.wallId,
      kind: o.kind,
      along: +o.along.toFixed(3),
      width: o.width,
      height: o.height,
      sill: o.sill,
      side: o.side,
    })),
  }
}

/**
 * Rehydrate a stored graph into a live model. The one place that knows stored
 * points are [x, y] tuples while the live model uses { x, y } — every caller
 * (editor, thumbnail, scene insertion) goes through here.
 *
 * Everything is deep-copied: the editor mutates the live model in place, and
 * none of that may reach the stored record. And nextId resumes past every
 * stored id, so a wall drawn after a reopen never reuses an existing one.
 */
export function planFromJSON(stored: StoredPlan): PlanState {
  const state = createPlan()
  state.walls = (stored.walls as { id: string; a: PlanPoint | [number, number]; b: PlanPoint | [number, number]; thickness: number; height: number }[]).map((w) => ({
    id: w.id,
    a: Array.isArray(w.a) ? { x: w.a[0], y: w.a[1] } : { x: w.a.x, y: w.a.y },
    b: Array.isArray(w.b) ? { x: w.b[0], y: w.b[1] } : { x: w.b.x, y: w.b.y },
    thickness: w.thickness,
    height: w.height,
  }))
  state.openings = (stored.openings as PlanOpening[]).map((o) => ({ ...o }))
  let maxId = 0
  for (const id of [...state.walls.map((w) => w.id), ...state.openings.map((o) => o.id)]) {
    const n = Number(id.replace(/^[a-z]+/, ''))
    if (Number.isFinite(n) && n > maxId) maxId = n
  }
  state.nextId = maxId + 1
  return state
}
