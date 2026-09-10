import { describe, expect, it } from 'vitest'
import { createPlan, planActions, planFromJSON, planToJSON, planVertices, planArea } from './floorPlanModel'

describe('planFromJSON round-trip', () => {
  it('rehydrates [x,y] tuples back into {x,y} points so vertices resolve', () => {
    const live = createPlan()
    planActions.stampRectangle(live, { x: 0, y: 0 }, { x: 5, y: 4 })
    const json = planToJSON(live)
    // what actually lands on the record: points are [x, y] tuples
    expect(Array.isArray(json.walls[0]!.a)).toBe(true)
    const restored = planFromJSON({ walls: json.walls, openings: json.openings })
    // the bug this guards: planVertices used to throw on tuple points
    const verts = planVertices(restored.walls)
    expect(verts).toHaveLength(4)
    expect(planArea(restored.walls)).toBeCloseTo(20, 3)
    expect(restored.walls[0]!.a).toEqual({ x: 0, y: 0 })
  })

  it('stores nothing derived: no rooms array in the saved shape (FR-010)', () => {
    const live = createPlan()
    planActions.stampRectangle(live, { x: 0, y: 0 }, { x: 5, y: 4 })
    const json = planToJSON(live)
    expect(json).not.toHaveProperty('rooms')
    expect(Object.keys(json).sort()).toEqual(['openings', 'unit', 'walls'])
  })

  it('tolerates already-shaped {x,y} points for forward compatibility', () => {
    const restored = planFromJSON({
      walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.1, height: 2.4 }],
      openings: [],
    })
    expect(restored.walls[0]!.a).toEqual({ x: 0, y: 0 })
  })

  it('restores nextId past every stored id, so new walls never collide after a reopen', () => {
    const live = createPlan()
    planActions.stampRectangle(live, { x: 0, y: 0 }, { x: 5, y: 4 })
    const json = planToJSON(live) // walls w1..w4
    const restored = planFromJSON({ walls: json.walls, openings: json.openings })
    planActions.chainClick(restored, { x: 0, y: 5 }, { snap: false })
    planActions.chainClick(restored, { x: 5, y: 5 }, { snap: false })
    const ids = restored.walls.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('deep-copies openings, so editing a reopened plan never mutates the stored record', () => {
    const live = createPlan()
    planActions.stampRectangle(live, { x: 0, y: 0 }, { x: 5, y: 4 })
    const bottom = live.walls.find((w) => w.a.y === 4 && w.b.y === 4)!
    planActions.placeOpening(live, bottom.id, 2.5, 'door')
    const json = planToJSON(live)
    const restored = planFromJSON({ walls: json.walls, openings: json.openings })
    const door = restored.openings[0]!
    planActions.moveOpening(restored, door.id, 3.5)
    // the stored record's opening did not move
    expect(json.openings[0]!.along).toBe(2.5)
  })
})
