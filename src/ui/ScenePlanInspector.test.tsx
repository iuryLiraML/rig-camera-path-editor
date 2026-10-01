// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { planActions, planFromJSON, planToJSON } from '../lib/floorPlanModel'
import { makePlanObject, useSceneStore } from '../state/useSceneStore'
import { useEditorStore } from '../state/useEditorStore'
import { ScenePlanInspector } from './ScenePlanInspector'

function addPlan() {
  const plan = planFromJSON({ walls: [], openings: [] })
  planActions.stampRectangle(plan, { x: 0, y: 0 }, { x: 4, y: 4 })
  const object = makePlanObject('Room', planToJSON(plan), { id: 'scene-plan' })
  useSceneStore.setState({ objects: [object] })
  useEditorStore.setState({ selection: 'obj:scene-plan', workspaceMode: 'build', scenePlanEdit: null })
  return object
}

beforeEach(() => addPlan())
afterEach(() => {
  cleanup()
  useSceneStore.setState({ objects: [] })
  useEditorStore.setState({ selection: null, scenePlanEdit: null, workspaceMode: 'build' })
})

describe('ScenePlanInspector', () => {
  it('enters an explicit Plan edit mode instead of changing normal object selection', () => {
    const { getByRole } = render(<ScenePlanInspector objectId="scene-plan" />)
    fireEvent.click(getByRole('button', { name: 'Edit Plan' }))

    expect(useEditorStore.getState().scenePlanEdit).toEqual({ objectId: 'scene-plan', target: null })
    expect(getByRole('button', { name: 'Done editing Plan' })).toBeTruthy()
  })

  it('offers the selected Plan a direct route back to Build outside structural mode', () => {
    useEditorStore.setState({ workspaceMode: 'compose' })
    const { getByRole } = render(<ScenePlanInspector objectId="scene-plan" />)
    fireEvent.click(getByRole('button', { name: 'Edit in Build' }))

    expect(useEditorStore.getState().workspaceMode).toBe('build')
    expect(useEditorStore.getState().scenePlanEdit?.objectId).toBe('scene-plan')
  })

  it('updates the selected wall through a contextual slider', () => {
    const object = useSceneStore.getState().objects[0]!
    const wallId = planFromJSON(object.plan!).walls[0]!.id
    useEditorStore.setState({ scenePlanEdit: { objectId: object.id, target: { kind: 'wall', wallId } } })
    const { getByLabelText } = render(<ScenePlanInspector objectId="scene-plan" />)
    fireEvent.change(getByLabelText('Wall height'), { target: { value: '3.1' } })

    expect(planFromJSON(useSceneStore.getState().objects[0]!.plan!).walls[0]!.height).toBeCloseTo(3.1)
  })
})
