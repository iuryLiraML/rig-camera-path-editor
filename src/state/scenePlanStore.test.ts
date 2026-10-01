import { afterEach, describe, expect, it } from 'vitest'
import { planActions, planFromJSON, planToJSON, type StoredPlan } from '../lib/floorPlanModel'
import { updateScenePlanWall } from '../lib/scenePlan'
import { makePlanObject, useSceneStore } from './useSceneStore'

function plan(): StoredPlan {
  const state = planFromJSON({ walls: [], openings: [] })
  planActions.stampRectangle(state, { x: 0, y: 0 }, { x: 4, y: 4 })
  return planToJSON(state)
}

afterEach(() => useSceneStore.setState({ objects: [] }))

describe('Scene Plan storage', () => {
  it('rebuilds only the selected scene instance and retains the reusable source graph', () => {
    const source = plan()
    const object = makePlanObject('Kitchen', source, { id: 'plan-instance' })
    useSceneStore.setState({ objects: [object] })

    const wallId = planFromJSON(source).walls[0]!.id
    const local = updateScenePlanWall(object.plan!, wallId, { height: 3.2 })
    useSceneStore.getState().setScenePlan(object.id, local.plan)

    expect(planFromJSON(source).walls[0]!.height).toBe(2.4)
    expect(planFromJSON(useSceneStore.getState().objects[0]!.plan!).walls[0]!.height).toBe(3.2)
    expect(useSceneStore.getState().objects[0]!.root).not.toBe(object.root)
  })

  it('duplicates a Scene Plan as another independent editable instance', () => {
    const source = plan()
    const object = makePlanObject('Kitchen', source, { id: 'plan-instance' })
    useSceneStore.setState({ objects: [object] })
    useSceneStore.getState().duplicateObject(object.id)
    const copy = useSceneStore.getState().objects.find((item) => item.id !== object.id)!
    const wallId = planFromJSON(copy.plan!).walls[0]!.id

    useSceneStore.getState().setScenePlan(copy.id, updateScenePlanWall(copy.plan!, wallId, { thickness: 0.22 }).plan)

    expect(copy.plan).toBeDefined()
    expect(planFromJSON(useSceneStore.getState().objects.find((item) => item.id === object.id)!.plan!).walls[0]!.thickness).toBe(0.1)
    expect(planFromJSON(useSceneStore.getState().objects.find((item) => item.id === copy.id)!.plan!).walls[0]!.thickness).toBe(0.22)
  })
})
