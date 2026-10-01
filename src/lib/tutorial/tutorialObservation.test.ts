import { afterEach, describe, expect, it } from 'vitest'
import { createLegacyProjectWorkflow } from '../projectWorkflow'
import { createPlan, planActions, planToJSON, type PlanState } from '../floorPlanModel'
import { makeDummyObject } from '../dummyCharacter'
import { useEditorStore } from '../../state/useEditorStore'
import { useProjectStore } from '../../state/useProjectStore'
import { useRigStore } from '../../state/useRigStore'
import { CAMERA_PATH_ID, makeAnchor, usePathStore } from '../../state/usePathStore'
import { makePlanObject, makePrimitive, useSceneStore } from '../../state/useSceneStore'
import { updateScenePlanWall } from '../scenePlan'
import { newTutorialProgressV2, isTutorialProgressV2 } from './tutorialProgress'
import { ensureTutorialObservation, observeTutorialPlanSaved, observeTutorialScenePlanCommitted, registerTutorialFigure, registerTutorialPlanBaseline, tutorialShotSignature } from './tutorialObservation'

function lessonAt(actionId: string, actions: Record<string, { status: 'practiced' | 'confirmed'; evidence: { kind: string; sceneId: string; subjectId?: string } }>) {
  const workflow = createLegacyProjectWorkflow('Tutorial')
  workflow.tutorial = {
    ...newTutorialProgressV2('scene-1'),
    currentActionId: actionId,
    artifacts: { planAssetId: 'plan-1' },
    actions,
  }
  useProjectStore.setState({ projectId: 'project-1', activeSceneId: 'scene-1', workflow })
}

function rectangle(): PlanState {
  const plan = createPlan()
  planActions.stampRectangle(plan, { x: 0, y: 0 }, { x: 4, y: 4 })
  return plan
}

afterEach(() => {
  useProjectStore.setState({ projectId: '', activeSceneId: '', workflow: createLegacyProjectWorkflow('x') })
  useEditorStore.getState().setShowAddDrawer(false)
  useSceneStore.setState({ objects: [] })
})

describe('tutorial outcomes from app state', () => {
  it('records a Plan edit only when the saved wall graph differs and remains enclosed', () => {
    lessonAt('room.edit', {
      'room.create': { status: 'practiced', evidence: { kind: 'created-plan', sceneId: 'scene-1', subjectId: 'plan-1' } },
    })
    const original = rectangle()
    registerTutorialPlanBaseline('plan-1', original)
    const edited = structuredClone(original)
    for (const wall of edited.walls) {
      wall.a = { x: wall.a.x * 1.5, y: wall.a.y * 1.25 }
      wall.b = { x: wall.b.x * 1.5, y: wall.b.y * 1.25 }
    }
    observeTutorialPlanSaved('plan-1', edited)
    const progress = useProjectStore.getState().workflow.tutorial
    expect(isTutorialProgressV2(progress) && progress.actions['room.edit']).toMatchObject({
      status: 'practiced', evidence: { kind: 'saved-enclosed-room-edit', sceneId: 'scene-1', subjectId: 'plan-1' },
    })
  })

  it('requires a hosted valid door and does not mark a no-op Plan save', () => {
    lessonAt('room.door', {
      'room.create': { status: 'practiced', evidence: { kind: 'created-plan', sceneId: 'scene-1', subjectId: 'plan-1' } },
      'room.edit': { status: 'practiced', evidence: { kind: 'saved-enclosed-room-edit', sceneId: 'scene-1', subjectId: 'plan-1' } },
    })
    const plan = rectangle()
    registerTutorialPlanBaseline('plan-1', plan)
    observeTutorialPlanSaved('plan-1', plan)
    let progress = useProjectStore.getState().workflow.tutorial
    expect(isTutorialProgressV2(progress) && progress.actions['room.door']).toBeUndefined()

    const opening = planActions.placeOpening(plan, plan.walls[0]!.id, 2, 'door').openings.at(-1)!
    observeTutorialPlanSaved('plan-1', plan)
    progress = useProjectStore.getState().workflow.tutorial
    expect(opening.kind).toBe('door')
    expect(isTutorialProgressV2(progress) && progress.actions['room.door']?.status).toBe('practiced')
  })

  it('records a structural change made to the lesson-bound Scene Plan copy', () => {
    lessonAt('room.scene-edit', {
      'room.insert': { status: 'practiced', evidence: { kind: 'inserted-plan-copy', sceneId: 'scene-1', subjectId: 'plan-copy-1' } },
    })
    const plan = rectangle()
    const object = makePlanObject('Lesson room', planToJSON(plan), { id: 'plan-copy-1' })
    const workflow = useProjectStore.getState().workflow
    const progress = workflow.tutorial
    if (!isTutorialProgressV2(progress)) throw new Error('expected v2 tutorial')
    useProjectStore.setState({ workflow: { ...workflow, tutorial: { ...progress, artifacts: { ...progress.artifacts, planObjectId: object.id } } } })
    useSceneStore.setState({ objects: [object] })
    ensureTutorialObservation()
    const result = updateScenePlanWall(object.plan!, plan.walls[0]!.id, { height: 3 })
    useSceneStore.getState().setScenePlan(object.id, result.plan)
    observeTutorialScenePlanCommitted(object.id)

    const observed = useProjectStore.getState().workflow.tutorial
    expect(isTutorialProgressV2(observed) && observed.actions['room.scene-edit']).toMatchObject({
      status: 'practiced', evidence: { kind: 'edited-scene-plan-copy', sceneId: 'scene-1', subjectId: object.id },
    })
  })

  it('binds the added Figure and closes the tray after the lesson observes it', () => {
    lessonAt('figure.add', {
      'room.insert': { status: 'practiced', evidence: { kind: 'inserted-plan-copy', sceneId: 'scene-1', subjectId: 'plan-copy-1' } },
      'room.scene-edit': { status: 'practiced', evidence: { kind: 'edited-scene-plan-copy', sceneId: 'scene-1', subjectId: 'plan-copy-1' } },
    })
    const figure = makeDummyObject({ id: 'figure-1' })
    useSceneStore.setState({ objects: [figure] })
    useEditorStore.getState().setShowAddDrawer(true)

    registerTutorialFigure(figure.id)

    const progress = useProjectStore.getState().workflow.tutorial
    expect(isTutorialProgressV2(progress) && progress.artifacts.figureId).toBe('figure-1')
    expect(isTutorialProgressV2(progress) && progress.actions['figure.add']?.status).toBe('practiced')
    expect(useEditorStore.getState().showAddDrawer).toBe(false)
  })

  it('only observes removal of the lesson-owned practice cube', () => {
    lessonAt('navigate.recover', {
      'navigate.view': { status: 'confirmed', evidence: { kind: 'learner-confirmed-practice', sceneId: 'scene-1' } },
    })
    const cube = makePrimitive('box', { id: 'practice-cube-1' })
    const unrelated = makePrimitive('sphere', { id: 'unrelated-sphere' })
    useSceneStore.setState({ objects: [cube, unrelated] })
    const workflow = useProjectStore.getState().workflow
    const progress = workflow.tutorial
    if (!isTutorialProgressV2(progress)) throw new Error('expected v2 tutorial')
    useProjectStore.setState({ workflow: { ...workflow, tutorial: { ...progress, artifacts: { practiceCubeId: cube.id } } } })
    ensureTutorialObservation()

    useSceneStore.setState({ objects: [cube] })
    let observed = useProjectStore.getState().workflow.tutorial
    expect(isTutorialProgressV2(observed) && observed.actions['navigate.recover']).toBeUndefined()

    useSceneStore.setState({ objects: [] })
    observed = useProjectStore.getState().workflow.tutorial
    expect(isTutorialProgressV2(observed) && observed.actions['navigate.recover']).toMatchObject({
      status: 'practiced', evidence: { kind: 'removed-named-practice-cube', subjectId: cube.id },
    })
  })

  it('records a transform and manual pose on the bound Figure after each action begins', () => {
    lessonAt('figure.add', {
      'room.insert': { status: 'practiced', evidence: { kind: 'inserted-plan-copy', sceneId: 'scene-1', subjectId: 'plan-copy-1' } },
      'room.scene-edit': { status: 'practiced', evidence: { kind: 'edited-scene-plan-copy', sceneId: 'scene-1', subjectId: 'plan-copy-1' } },
    })
    const figure = makeDummyObject({ id: 'figure-transform-test' })
    useSceneStore.setState({ objects: [figure] })
    registerTutorialFigure(figure.id)
    ensureTutorialObservation()

    let workflow = useProjectStore.getState().workflow
    const progress = workflow.tutorial
    if (!isTutorialProgressV2(progress)) throw new Error('expected v2 tutorial')
    useProjectStore.setState({ workflow: { ...workflow, tutorial: { ...progress, currentActionId: 'figure.place' } } })
    const moved = { ...figure, transform: { ...figure.transform, position: [0.4, 0, 0] as [number, number, number] } }
    useSceneStore.setState({ objects: [moved] })

    workflow = useProjectStore.getState().workflow
    const placed = workflow.tutorial
    if (!isTutorialProgressV2(placed)) throw new Error('expected v2 tutorial')
    expect(placed.actions['figure.place']).toMatchObject({ status: 'practiced', evidence: { subjectId: figure.id } })
    useProjectStore.setState({ workflow: { ...workflow, tutorial: { ...placed, currentActionId: 'figure.pose' } } })
    const posed = { ...moved, bonePose: { LeftArm: [0, 0, 18] as [number, number, number] } }
    useSceneStore.setState({ objects: [posed] })

    const updated = useProjectStore.getState().workflow.tutorial
    expect(isTutorialProgressV2(updated) && updated.actions['figure.pose']).toMatchObject({
      status: 'practiced', evidence: { kind: 'posed-bound-figure', subjectId: figure.id },
    })
  })

  it('observes the followed open route, usable height and two lens keys on the same move', () => {
    const lessonPath = {
      id: CAMERA_PATH_ID,
      name: 'Camera Path',
      anchors: [makeAnchor([0, 0.1, 0]), makeAnchor([0, 0.1, 4])],
      closed: false,
      rounding: 0.8,
    }
    usePathStore.setState({ activePathId: CAMERA_PATH_ID, paths: [lessonPath] })
    useRigStore.setState({ cameraKind: 'path', cameraPathId: CAMERA_PATH_ID, pathSpace: 'object', targetObjectId: 'figure-1' })
    useEditorStore.setState({ tool: 'pen' })
    lessonAt('camera.path', {
      'camera.select': { status: 'practiced', evidence: { kind: 'renamed-active-camera-option', sceneId: 'scene-1', subjectId: 'camera-1' } },
    })
    let workflow = useProjectStore.getState().workflow
    const initial = workflow.tutorial
    if (!isTutorialProgressV2(initial)) throw new Error('expected v2 tutorial')
    useProjectStore.setState({ workflow: { ...workflow, tutorial: { ...initial, artifacts: { cameraOptionId: 'camera-1', pathId: CAMERA_PATH_ID } } } })
    ensureTutorialObservation()

    let observed = useProjectStore.getState().workflow.tutorial
    if (!isTutorialProgressV2(observed)) throw new Error('expected v2 tutorial')
    expect(observed.actions['camera.path']).toBeUndefined()
    useRigStore.setState({ pathSpace: 'world' })
    observed = useProjectStore.getState().workflow.tutorial
    if (!isTutorialProgressV2(observed)) throw new Error('expected v2 tutorial')
    expect(observed.actions['camera.path']).toBeUndefined()
    useEditorStore.getState().setTool('select')
    observed = useProjectStore.getState().workflow.tutorial
    if (!isTutorialProgressV2(observed)) throw new Error('expected v2 tutorial')
    expect(observed.actions['camera.path']).toMatchObject({ status: 'practiced', evidence: { subjectId: CAMERA_PATH_ID } })
    workflow = useProjectStore.getState().workflow
    observed = workflow.tutorial
    if (!isTutorialProgressV2(observed)) throw new Error('expected v2 tutorial')
    useProjectStore.setState({ workflow: { ...workflow, tutorial: { ...observed, currentActionId: 'camera.height' } } })
    let updated = useProjectStore.getState().workflow.tutorial
    expect(isTutorialProgressV2(updated) && updated.actions['camera.height']).toBeUndefined()
    usePathStore.getState().setPathHeight(1.5)
    updated = useProjectStore.getState().workflow.tutorial
    expect(isTutorialProgressV2(updated) && updated.actions['camera.height']).toMatchObject({
      status: 'practiced', evidence: { kind: 'raised-camera-path-endpoints', subjectId: CAMERA_PATH_ID },
    })

    workflow = useProjectStore.getState().workflow
    observed = workflow.tutorial
    if (!isTutorialProgressV2(observed)) throw new Error('expected v2 tutorial')
    useProjectStore.setState({ workflow: {
      ...workflow,
      tutorial: {
        ...observed,
        currentActionId: 'timing.lens',
        actions: {
          ...observed.actions,
          'timing.duration': { status: 'practiced', evidence: { kind: 'set-six-seconds-and-scrubbed', sceneId: 'scene-1' } },
        },
      },
    } })
    useRigStore.setState({ fovKeys: [{ id: 'fov-start', time: 0, value: 45 }, { id: 'fov-end', time: 1, value: 40 }] })

    updated = useProjectStore.getState().workflow.tutorial
    expect(isTutorialProgressV2(updated) && updated.actions['timing.lens']).toMatchObject({
      status: 'practiced', evidence: { kind: 'keyed-camera-fov-at-both-ends', subjectId: 'camera-1' },
    })
  })

  it('changes the review signature when camera timing changes', () => {
    lessonAt('finish.review', {})
    const first = tutorialShotSignature()
    useRigStore.getState().setDuration(8)
    expect(tutorialShotSignature()).not.toBe(first)
  })
})
