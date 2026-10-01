import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { planActions, planFromJSON, planToJSON } from './floorPlanModel'
import { buildPlanGroup } from './planGeometry'

describe('buildPlanGroup scene targets', () => {
  it('marks derived room, wall, and opening meshes for Scene Plan direct selection', () => {
    const plan = planFromJSON({ walls: [], openings: [] })
    planActions.stampRectangle(plan, { x: 0, y: 0 }, { x: 4, y: 4 })
    planActions.placeOpening(plan, plan.walls[0]!.id, 2, 'door')
    const group = buildPlanGroup(planToJSON(plan))
    const targets: unknown[] = []
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) targets.push(child.userData.scenePlanTarget)
    })

    expect(targets).toContainEqual({ kind: 'wall', wallId: plan.walls[0]!.id })
    expect(targets.some((target) => (target as { kind?: string } | undefined)?.kind === 'room')).toBe(true)
    expect(targets).toContainEqual({ kind: 'opening', openingId: plan.openings[0]!.id })
  })
})
