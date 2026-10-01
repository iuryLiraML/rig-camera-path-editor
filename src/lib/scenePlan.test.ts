import { describe, expect, it } from 'vitest'
import {
  openingIssue,
  planFromJSON,
  planRooms,
  planToJSON,
  planActions,
  type StoredPlan,
} from './floorPlanModel'
import {
  resizeScenePlanRoom,
  resizeScenePlanWall,
  isRectangularRoom,
  roomKey,
  updateScenePlanOpening,
  updateScenePlanWall,
} from './scenePlan'

function squarePlan(): StoredPlan {
  const plan = planFromJSON({ walls: [], openings: [] })
  planActions.stampRectangle(plan, { x: 0, y: 0 }, { x: 4, y: 4 })
  planActions.placeOpening(plan, plan.walls[0]!.id, 2, 'door')
  return planToJSON(plan)
}

describe('Scene Plan mutations', () => {
  it('keeps every opening hosted when a shared corner moves', () => {
    const source = planToJSON(planFromJSON({
      walls: [
        { id: 'left', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, height: 2.4, thickness: 0.1 },
        { id: 'right', a: { x: 4, y: 0 }, b: { x: 8, y: 0 }, height: 2.4, thickness: 0.1 },
      ],
      openings: [{ id: 'door', wallId: 'right', kind: 'door', side: 1, along: 2, width: 0.9, height: 2.1, sill: 0 }],
    }))
    const result = resizeScenePlanWall(source, 'left', 7)
    const next = planFromJSON(result.plan)
    expect(next.walls.find((wall) => wall.id === 'right')!.a.x).toBeCloseTo(5.55)
    expect(next.openings.every((opening) => openingIssue(next, opening) === null)).toBe(true)
  })

  it('identifies irregular Rooms without requiring a fourth point', () => {
    const plan = planFromJSON({
      walls: [
        { id: 'a', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, height: 2.4, thickness: 0.1 },
        { id: 'b', a: { x: 4, y: 0 }, b: { x: 2, y: 3 }, height: 2.4, thickness: 0.1 },
        { id: 'c', a: { x: 2, y: 3 }, b: { x: 0, y: 0 }, height: 2.4, thickness: 0.1 },
      ],
      openings: [],
    })
    expect(isRectangularRoom(planRooms(plan.walls)[0]!)).toBe(false)
  })

  it('keeps an opening at its distance from the fixed endpoint when its wall is lengthened', () => {
    const source = squarePlan()
    const wallId = String(source.walls[0] && (source.walls[0] as { id: string }).id)

    const result = resizeScenePlanWall(source, wallId, 6)
    const next = planFromJSON(result.plan)
    const wall = next.walls.find((item) => item.id === wallId)!
    const opening = next.openings[0]!

    expect(wall.b).toEqual({ x: 6, y: 0 })
    expect(opening.along).toBe(2)
    expect(result.changed).toBe(true)
  })

  it('stops a wall resize before it would move, shrink, or detach a hosted opening', () => {
    const source = squarePlan()
    const wallId = String(source.walls[0] && (source.walls[0] as { id: string }).id)

    const result = resizeScenePlanWall(source, wallId, 1)
    const next = planFromJSON(result.plan)

    expect(next.walls.find((item) => item.id === wallId)!.b.x).toBeCloseTo(2.45)
    expect(next.openings[0]).toMatchObject({ along: 2, width: 0.9 })
    expect(result.note).toMatch(/fixed endpoint/i)
  })

  it('keeps a door sill at floor level and stops an opening at the nearest free position', () => {
    const source = squarePlan()
    const first = planFromJSON(source)
    const wallId = first.walls[0]!.id
    planActions.placeOpening(first, wallId, 3.3, 'window')
    const withWindow = planToJSON(first)
    const windowId = first.openings.find((opening) => opening.kind === 'window')!.id

    const sill = updateScenePlanOpening(withWindow, windowId, { sill: 1.1 })
    expect(planFromJSON(sill.plan).openings.find((opening) => opening.id === windowId)!.sill).toBe(1.1)

    const overlap = updateScenePlanOpening(sill.plan, windowId, { along: 2 })
    expect(overlap.changed).toBe(true)
    expect(planFromJSON(overlap.plan).openings.find((opening) => opening.id === windowId)!.along).toBeCloseTo(3.05)

    const doorId = first.openings.find((opening) => opening.kind === 'door')!.id
    const door = updateScenePlanOpening(sill.plan, doorId, { sill: 0.7 })
    expect(planFromJSON(door.plan).openings.find((opening) => opening.id === doorId)!.sill).toBe(0)
  })

  it('clamps an oversized opening to the nearest valid width', () => {
    const state = planFromJSON(squarePlan())
    const wallId = state.walls[0]!.id
    planActions.placeOpening(state, wallId, 1, 'door')
    planActions.placeOpening(state, wallId, 3, 'door')
    const first = state.openings[0]!
    const result = updateScenePlanOpening(planToJSON(state), first.id, { width: 3 })
    const resized = planFromJSON(result.plan).openings.find((opening) => opening.id === first.id)!
    expect(result.changed).toBe(true)
    expect(resized.width).toBeLessThan(3)
    expect(openingIssue(planFromJSON(result.plan), resized)).toBeNull()
  })

  it('resizes a rectangular room through its stable wall identity', () => {
    const source = squarePlan()
    const state = planFromJSON(source)
    const room = planRooms(state.walls)[0]!
    const result = resizeScenePlanRoom(source, roomKey(room, state.walls), { width: 6, depth: 5 })
    const next = planFromJSON(result.plan)
    const resized = planRooms(next.walls)[0]!

    expect(resized.area).toBeCloseTo(30)
    expect(result.changed).toBe(true)
  })

  it('copies wall properties without mutating the reusable source object', () => {
    const source = squarePlan()
    const wallId = String(source.walls[0] && (source.walls[0] as { id: string }).id)
    const result = updateScenePlanWall(source, wallId, { height: 3.1, thickness: 0.18 })

    expect(planFromJSON(source).walls[0]).toMatchObject({ height: 2.4, thickness: 0.1 })
    expect(planFromJSON(result.plan).walls[0]).toMatchObject({ height: 3.1, thickness: 0.18 })
  })

  it('stops a wall-height slider at the tallest hosted opening', () => {
    const source = squarePlan()
    const state = planFromJSON(source)
    const wallId = state.walls[0]!.id
    planActions.placeOpening(state, wallId, 3.2, 'window')
    const window = state.openings.find((opening) => opening.kind === 'window')!
    window.sill = 1.1
    window.height = 1.4

    const result = updateScenePlanWall(planToJSON(state), wallId, { height: 1.5 })

    expect(planFromJSON(result.plan).walls.find((wall) => wall.id === wallId)!.height).toBeCloseTo(2.5)
    expect(result.note).toMatch(/height of its opening/i)
  })
})
