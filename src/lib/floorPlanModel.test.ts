import { describe, expect, it } from 'vitest'
import {
  DEFAULTS,
  createPlan,
  planActions,
  planRooms,
  planExtrude,
  planArea,
  wallLength,
  type PlanState,
} from './floorPlanModel'

/** A 6 × 4 shell, stamped. */
function shell(state: PlanState, w = 6, h = 4) {
  planActions.stampRectangle(state, { x: 0, y: 0 }, { x: w, y: h })
}

describe('floorPlanModel: stamping and areas', () => {
  it('stamps a 6 × 4 room as four walls and one room of 24 m²', () => {
    const s = createPlan()
    shell(s)
    expect(s.walls).toHaveLength(4)
    const rooms = planRooms(s.walls)
    expect(rooms).toHaveLength(1)
    expect(rooms[0]!.area).toBeCloseTo(24, 3)
  })

  it('refuses a rectangle smaller than one grid step', () => {
    const s = createPlan()
    planActions.stampRectangle(s, { x: 0, y: 0 }, { x: 0.1, y: 0.1 })
    expect(s.walls).toHaveLength(0)
    expect(s.note).toMatch(/small/i)
  })
})

describe('floorPlanModel: corner dragging and the trapezoid (SC-002, SC-003)', () => {
  it('dragging one corner of a 5 × 4 room from (5,4) to (7,4) yields 24 m², not 28', () => {
    const s = createPlan()
    shell(s, 5, 4)
    expect(planArea(s.walls)).toBeCloseTo(20, 3)
    // The far corner is shared by two walls; moving it moves both.
    planActions.beginEdit(s)
    planActions.moveVertex(s, '5.000,4.000', { x: 7, y: 4 })
    // The shape is now a trapezoid: parallel sides 5 and 7, height 4 → (5+7)/2 × 4 = 24.
    expect(planArea(s.walls)).toBeCloseTo(24, 3)
  })

  it('undo after the drag returns the area to 20 m²', () => {
    const s = createPlan()
    shell(s, 5, 4)
    planActions.beginEdit(s)
    planActions.moveVertex(s, '5.000,4.000', { x: 7, y: 4 })
    expect(planArea(s.walls)).toBeCloseTo(24, 3)
    planActions.undo(s)
    expect(planArea(s.walls)).toBeCloseTo(20, 3)
  })
})

describe('floorPlanModel: wall splitting at a T-junction (SC-001)', () => {
  it('a wall drawn across a 6 × 4 room splits the hosts and yields two rooms of 14 and 10 m²', () => {
    const s = createPlan()
    shell(s)
    // Chain from the middle of the top wall (3.5, 0) to the middle of the bottom wall (3.5, 4).
    planActions.chainClick(s, { x: 3.5, y: 0 }, { snap: true })
    planActions.chainClick(s, { x: 3.5, y: 4 }, { snap: true })
    planActions.endChain(s)
    // 4 shell walls → top and bottom each split into two (6) + the new interior wall (7).
    expect(s.walls).toHaveLength(7)
    const rooms = planRooms(s.walls)
    expect(rooms).toHaveLength(2)
    const areas = rooms.map((r) => r.area).sort((a, b) => a - b)
    expect(areas[0]).toBeCloseTo(10, 3) // 2.5 × 4
    expect(areas[1]).toBeCloseTo(14, 3) // 3.5 × 4
  })

  it('a wall that does not reach another wall encloses nothing', () => {
    const s = createPlan()
    shell(s)
    planActions.chainClick(s, { x: 3.5, y: 0 }, { snap: true })
    planActions.chainClick(s, { x: 3.5, y: 2 }, { snap: true }) // stops mid-room
    planActions.endChain(s)
    expect(planRooms(s.walls)).toHaveLength(1)
  })
})

describe('floorPlanModel: openings never overhang (FR-011)', () => {
  it('hosts a door on a wall and clamps it inside the ends', () => {
    const s = createPlan()
    shell(s)
    const bottom = s.walls.find((w) => w.a.y === 4 && w.b.y === 4)!
    planActions.placeOpening(s, bottom.id, 0.1, 'door')
    const o = s.openings[0]!
    // A 0.9 m door cannot sit 0.1 m along; it clamps to half its width.
    expect(o.along).toBeCloseTo(0.45, 3)
  })

  it('refuses an opening wider than its wall with a stated reason', () => {
    const s = createPlan()
    shell(s, 0.5, 4) // 0.5 m wall — narrower than a 0.9 m door
    const short = s.walls.find((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) < 1)!
    planActions.placeOpening(s, short.id, 0.25, 'door')
    expect(s.openings).toHaveLength(0)
    expect(s.note).toMatch(/needs|too/i)
  })

  it('narrows an opening when a corner move shortens its host below the opening width', () => {
    const s = createPlan()
    shell(s, 5, 4)
    const bottom = s.walls.find((w) => w.a.y === 4 && w.b.y === 4)!
    planActions.placeOpening(s, bottom.id, 2.5, 'window') // 1.2 m wide
    // Drag the far corner inward so the bottom wall shrinks to 1 m.
    planActions.beginEdit(s)
    planActions.moveVertex(s, '5.000,4.000', { x: 1, y: 4 })
    const o = s.openings[0]!
    const host = s.walls.find((w) => w.id === o.wallId)!
    const hostLen = Math.hypot(host.b.x - host.a.x, host.b.y - host.a.y)
    expect(o.width).toBeLessThanOrEqual(hostLen + 1e-9)
    expect(o.along).toBeGreaterThanOrEqual(o.width / 2 - 1e-9)
    expect(o.along).toBeLessThanOrEqual(hostLen - o.width / 2 + 1e-9)
  })
})

describe('floorPlanModel: rehosting (SC-004)', () => {
  it('moves a door onto a perpendicular wall and clamps it within that wall', () => {
    const s = createPlan()
    shell(s, 5, 4)
    const bottom = s.walls.find((w) => w.a.y === 4 && w.b.y === 4)!
    planActions.placeOpening(s, bottom.id, 2.5, 'door')
    const o = s.openings[0]!
    const left = s.walls.find((w) => w.a.x === 0 && w.b.x === 0)!
    planActions.rehostOpening(s, o.id, left.id, 2.0)
    expect(o.wallId).toBe(left.id)
    const hostLen = Math.hypot(left.b.x - left.a.x, left.b.y - left.a.y)
    expect(o.along).toBeLessThanOrEqual(hostLen - o.width / 2 + 1e-9)
  })
})

describe('floorPlanModel: extrusion has no boolean ops (FR-031)', () => {
  it('a window produces a sill below and a lintel above, not a hole', () => {
    const s = createPlan()
    shell(s)
    const bottom = s.walls.find((w) => w.a.y === 4 && w.b.y === 4)!
    planActions.placeOpening(s, bottom.id, 3, 'window') // sill 0.9, height 1.0, wall height 2.4
    const pieces = planExtrude(s).filter((p) => p.wall.id === bottom.id)
    // Two jambs + a sill (0→0.9) + a lintel (1.9→2.4) = 4 pieces on this wall.
    expect(pieces.length).toBe(4)
    const spans = pieces.map((p) => [p.y0, p.y1])
    const hasSill = spans.some(([y0, y1]) => y0 === 0 && Math.abs(y1 - 0.9) < 1e-9)
    const hasLintel = spans.some(([y0, y1]) => Math.abs(y0 - 1.9) < 1e-9 && Math.abs(y1 - 2.4) < 1e-9)
    expect(hasSill).toBe(true)
    expect(hasLintel).toBe(true)
  })

  it('a door produces jambs and a lintel but no sill', () => {
    const s = createPlan()
    shell(s)
    const bottom = s.walls.find((w) => w.a.y === 4 && w.b.y === 4)!
    planActions.placeOpening(s, bottom.id, 3, 'door')
    const pieces = planExtrude(s).filter((p) => p.wall.id === bottom.id)
    // Two jambs + a lintel (2.1→2.4) = 3 pieces, none starting at y0=0 under the door.
    expect(pieces.length).toBe(3)
    const sillUnderDoor = pieces.some((p) => p.y0 === 0 && p.y1 < 2.0)
    expect(sillUnderDoor).toBe(false)
  })
})

describe('floorPlanModel: rooms are derived, never stored (FR-010)', () => {it('no rooms array survives a snapshot round-trip', () => {
    const s = createPlan()
    shell(s)
    planActions.beginEdit(s)
    planActions.undo(s) // forces a snapshot push/restore cycle
    const json = JSON.stringify(s)
    expect(json).not.toMatch(/"rooms"\s*:/)
  })
})

describe('floorPlanModel: defaults (FR-013)', () => {
  it('uses 2.4 m walls, 0.1 m thickness, 0.25 m grid, and the spec opening sizes', () => {
    expect(DEFAULTS.wallHeight).toBe(2.4)
    expect(DEFAULTS.wallThickness).toBe(0.1)
    expect(DEFAULTS.grid).toBe(0.25)
    const s = createPlan()
    shell(s)
    expect(s.walls[0]!.height).toBe(2.4)
    expect(s.walls[0]!.thickness).toBe(0.1)
    const bottom = s.walls.find((w) => w.a.y === 4 && w.b.y === 4)!
    planActions.placeOpening(s, bottom.id, 3, 'door')
    planActions.placeOpening(s, bottom.id, 1, 'window')
    const door = s.openings.find((o) => o.kind === 'door')!
    const win = s.openings.find((o) => o.kind === 'window')!
    expect([door.width, door.height, door.sill]).toEqual([0.9, 2.1, 0])
    expect([win.width, win.height, win.sill]).toEqual([1.2, 1.0, 0.9])
  })
})

describe('floorPlanModel: degenerate walls (edge case)', () => {
  it('drops a wall collapsed to zero length by a corner drag, with its openings', () => {
    const s = createPlan()
    shell(s, 5, 4)
    const bottom = s.walls.find((w) => w.a.y === 4 && w.b.y === 4)!
    planActions.placeOpening(s, bottom.id, 2.5, 'door')
    // drag the bottom-right corner onto the bottom-left corner
    planActions.beginEdit(s)
    planActions.moveVertex(s, '5.000,4.000', { x: 0, y: 4 })
    expect(s.walls.find((w) => w.id === bottom.id)).toBeUndefined()
    expect(s.openings).toHaveLength(0)
    expect(s.note).toMatch(/collapsed/i)
  })
})

describe('floorPlanModel: wall drag honors the snap toggle (FR-029)', () => {
  it('moves off-grid when snap is off, and to the grid when on', () => {
    const s = createPlan()
    shell(s, 5, 4)
    const top = s.walls.find((w) => w.a.y === 0 && w.b.y === 0)!
    planActions.moveWall(s, top.id, { x: 0.13, y: 0 }, { snap: false })
    expect(top.a.x).toBeCloseTo(0.13, 3)
    planActions.moveWall(s, top.id, { x: 0.13, y: 0 }, { snap: true })
    expect(top.a.x).toBeCloseTo(0.25, 3) // 0.26 snapped to the 0.25 grid
  })
})

describe('floorPlanModel: the module holds no mutable globals', () => {
  it('two plans mint independent ids, so test order cannot leak between them', () => {
    const a = createPlan()
    const b = createPlan()
    planActions.stampRectangle(a, { x: 0, y: 0 }, { x: 2, y: 2 })
    planActions.stampRectangle(b, { x: 0, y: 0 }, { x: 2, y: 2 })
    // both start their ids at w1 — no shared counter
    expect(a.walls[0]!.id).toBe('w1')
    expect(b.walls[0]!.id).toBe('w1')
  })
})

describe('floorPlanModel: version broadcasts in-place mutation', () => {
  it('every mutation bumps version even though the reference never changes', () => {
    const s = createPlan()
    const ref = s
    const v0 = s.version
    planActions.stampRectangle(s, { x: 0, y: 0 }, { x: 5, y: 4 })
    expect(s).toBe(ref) // same reference
    expect(s.version).toBeGreaterThan(v0)
    const v1 = s.version
    // a drag-time mutation that never touches the undo stack
    planActions.moveVertex(s, '5.000,4.000', { x: 7, y: 4 })
    expect(s.version).toBeGreaterThan(v1)
    const v2 = s.version
    planActions.undo(s)
    expect(s.version).toBeGreaterThan(v2)
  })
})

describe('floorPlanModel: split reassigns hosted openings (FR-012)', () => {
  it('each opening stays on the half it was on, with its distance rebased', () => {
    const s = createPlan()
    shell(s, 6, 4)
    const bottom = s.walls.find((w) => w.a.y === 4 && w.b.y === 4)!
    // the stamped bottom wall runs from (6,4) to (0,4) — along is measured from a
    planActions.placeOpening(s, bottom.id, 1.5, 'door') // before the split point
    planActions.placeOpening(s, bottom.id, 5.0, 'window') // past it
    // split the bottom wall at world x=3.5 — along = 6 − 3.5 = 2.5 from its start
    planActions.chainClick(s, { x: 3.5, y: 4 }, { snap: true })
    planActions.endChain(s)
    const door = s.openings.find((o) => o.kind === 'door')!
    const win = s.openings.find((o) => o.kind === 'window')!
    expect(door.wallId).not.toBe(bottom.id)
    expect(win.wallId).not.toBe(bottom.id)
    expect(door.wallId).not.toBe(win.wallId) // different halves
    expect(door.along).toBeCloseTo(1.5, 3) // same place on its half
    expect(win.along).toBeCloseTo(2.5, 3) // 5.0 − 2.5, rebased onto the second half
    // and both hosts are real walls that contain them
    for (const o of [door, win]) {
      const host = s.walls.find((w) => w.id === o.wallId)!
      expect(o.along).toBeLessThanOrEqual(wallLength(host) - o.width / 2 + 1e-9)
    }
  })
})

describe('floorPlanModel: delete notes say what went with them', () => {
  it('deleting a wall reports how many openings went', () => {
    const s = createPlan()
    shell(s, 5, 4)
    const bottom = s.walls.find((w) => w.a.y === 4 && w.b.y === 4)!
    planActions.placeOpening(s, bottom.id, 1.5, 'door')
    planActions.placeOpening(s, bottom.id, 3.5, 'window')
    planActions.remove(s, bottom.id)
    expect(s.openings).toHaveLength(0)
    expect(s.note).toMatch(/2 opening/)
  })

  it('deleting a corner reports how many walls went', () => {
    const s = createPlan()
    shell(s, 5, 4)
    planActions.removeVertex(s, '5.000,4.000')
    expect(s.walls).toHaveLength(2)
    expect(s.note).toMatch(/2 wall/)
  })
})

describe('floorPlanModel: SC-008 stays inside a frame budget', () => {
  it('40 walls and 12 openings derive rooms and extrusion in under 8 ms', () => {
    const s = createPlan()
    // a 10 × 4 grid of rooms: 10 columns × 4 rows of stamped cells sharing edges
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 4; j++) {
        planActions.stampRectangle(s, { x: i * 3, y: j * 3 }, { x: i * 3 + 2.5, y: j * 3 + 2.5 })
      }
    }
    for (let k = 0; k < 12; k++) {
      planActions.placeOpening(s, s.walls[k]!.id, 1.25, k % 2 ? 'window' : 'door')
    }
    expect(s.walls.length).toBeGreaterThanOrEqual(40)
    expect(s.openings).toHaveLength(12)
    const t0 = performance.now()
    planRooms(s.walls)
    planExtrude(s)
    const elapsed = performance.now() - t0
    // the computable half of a redraw; canvas rasterization is browser-only
    expect(elapsed).toBeLessThan(8)
  })
})

describe('opening placement and editing validation', () => {
  it('refuses overlapping openings without adding an undo entry', () => {
    const s = createPlan()
    shell(s, 5, 4)
    const wall = s.walls[0]!
    planActions.placeOpening(s, wall.id, 2, 'door')
    const history = s.undo.length
    planActions.placeOpening(s, wall.id, 2.2, 'window')
    expect(s.openings).toHaveLength(1)
    expect(s.undo).toHaveLength(history)
    expect(s.note).toMatch(/overlap/i)
  })

  it('refuses a window above the wall rather than generating a taller sill', () => {
    const s = createPlan()
    shell(s, 5, 4)
    const wall = s.walls[0]!
    planActions.placeOpening(s, wall.id, 2, 'window')
    const before = { ...s.openings[0]! }
    planActions.setOpening(s, before.id, { sill: 2 })
    expect(s.openings[0]).toEqual(before)
    expect(s.note).toMatch(/height|tall|above/i)
  })

  it('refuses a rehost into an occupied part of a wall', () => {
    const s = createPlan()
    shell(s, 5, 4)
    planActions.placeOpening(s, s.walls[0]!.id, 2, 'door')
    planActions.placeOpening(s, s.walls[1]!.id, 2, 'window')
    const door = s.openings[0]!
    planActions.rehostOpening(s, door.id, s.walls[1]!.id, 2)
    expect(door.wallId).toBe(s.walls[0]!.id)
  })
})
