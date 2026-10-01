import { afterEach, describe, expect, it } from 'vitest'
import {
  migrateTutorialProgress,
  newTutorialProgress,
  newTutorialProgressV2,
  isLegacyTutorialProgress,
  isTutorialProgressV2,
  TUTORIAL_STEP_COUNT,
} from './tutorialProgress'
import { TUTORIAL_ACTIONS, TUTORIAL_CHAPTERS, TUTORIAL_STEPS } from './steps'
import { evaluateTutorialAction, recordTutorialAction, skipTutorialAction } from './tutorialEvaluation'
import { recordObservedTutorialAction } from './tutorialActions'
import {
  advanceStep,
  advanceTutorialAction,
  backStep,
  backTutorialAction,
  confirmTutorialAction,
  getTutorial,
  isTutorialActive,
  pauseTutorial,
  recordTutorialExport,
  resumeTutorial,
  skipCurrentTutorialAction,
  skipTutorial,
} from './tutorialActions'
import { useProjectStore } from '../../state/useProjectStore'
import { useSceneStore } from '../../state/useSceneStore'
import { useCameraOptionsStore } from '../../state/useCameraOptionsStore'
import { usePathStore } from '../../state/usePathStore'
import { useEditorStore } from '../../state/useEditorStore'
import { useRigStore } from '../../state/useRigStore'
import { createLegacyProjectWorkflow } from '../projectWorkflow'

const step = (id: string) => {
  const s = TUTORIAL_STEPS.find((x) => x.id === id)
  if (!s) throw new Error(`no step ${id}`)
  return s
}

function seedTutorialWorkflow(stepIndex = 0) {
  const workflow = createLegacyProjectWorkflow('Tutorial')
  workflow.tutorial = { ...newTutorialProgress(), stepIndex }
  useProjectStore.setState({ workflow })
}

function seedV2Tutorial() {
  const workflow = createLegacyProjectWorkflow('Tutorial')
  workflow.tutorial = {
    ...newTutorialProgressV2('scene-1'),
    currentActionId: 'intro.start',
    actions: {
      'intro.result': { status: 'confirmed', evidence: { kind: 'preview-seen', sceneId: 'scene-1' } },
    },
  }
  useProjectStore.setState({ workflow, activeSceneId: 'scene-1' })
}

afterEach(() => {
  useProjectStore.setState({ workflow: createLegacyProjectWorkflow('x') })
  useSceneStore.setState({ objects: [] })
  useEditorStore.setState({ tool: 'select', exportMenuOpen: false })
})

describe('tutorial constants', () => {
  it('keeps the persisted step count in sync with the step list', () => {
    // migrateTutorialProgress clamps against TUTORIAL_STEP_COUNT; the engine uses
    // TUTORIAL_STEPS.length — they must not drift.
    expect(TUTORIAL_STEPS.length).toBe(TUTORIAL_STEP_COUNT)
  })

  it('starts a fresh tutorial at step 0 (replay makes a new lesson)', () => {
    const a = newTutorialProgress()
    const b = newTutorialProgress()
    expect(a).toMatchObject({ stepIndex: 0, active: true, done: false })
    expect(b.stepIndex).toBe(0)
  })

  it('defines seven practical chapters with twenty-one unique, stable actions', () => {
    expect(TUTORIAL_CHAPTERS).toHaveLength(7)
    expect(TUTORIAL_ACTIONS).toHaveLength(21)
    expect(new Set(TUTORIAL_ACTIONS.map((item) => item.id)).size).toBe(21)
    expect(TUTORIAL_ACTIONS.map((item) => item.id)).toContain('timing.lens')
    expect(TUTORIAL_ACTIONS.map((item) => item.id)).toContain('room.scene-edit')
    expect(TUTORIAL_ACTIONS.map((item) => item.id)).not.toContain('room.draw')
  })

  it('supplies visual input cues for each hands-on tutorial action', () => {
    const navigation = TUTORIAL_ACTIONS.find((action) => action.id === 'navigate.view')
    const placement = TUTORIAL_ACTIONS.find((action) => action.id === 'figure.place')
    expect(navigation?.hints).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Orbit', input: 'mouse-middle' }),
      expect.objectContaining({ label: 'Open Help', keys: ['?'] }),
    ]))
    expect(navigation?.touchHints).toEqual(expect.arrayContaining([
      expect.objectContaining({ input: 'touch', gesture: 'Pinch' }),
    ]))
    expect(placement?.hints).toEqual(expect.arrayContaining([
      expect.objectContaining({ keys: ['W'] }),
      expect.objectContaining({ keys: ['E'] }),
    ]))
  })

  it('explains the outstanding condition for every observed practice action', () => {
    const observedActions = TUTORIAL_ACTIONS.filter((action) => action.completion === 'practice')
    expect(observedActions).not.toHaveLength(0)
    for (const action of observedActions) {
      expect(action.completionHint, `${action.id} needs a visible completion condition`).toBeTruthy()
    }
    expect(TUTORIAL_ACTIONS.find((action) => action.id === 'navigate.recover')?.completionHint)
      .toContain('Practice Cube')
  })

  it('creates v2 progress keyed to a scene and the first action', () => {
    expect(newTutorialProgressV2('scene-1')).toMatchObject({
      version: 2,
      curriculumId: 'first-camera-move',
      sceneId: 'scene-1',
      currentActionId: 'intro.result',
      actions: {},
      export: { state: 'not-attempted' },
    })
  })
})

describe('migrateTutorialProgress', () => {
  it('rejects non-tutorial values so normal projects stay normal', () => {
    expect(migrateTutorialProgress(undefined)).toBeUndefined()
    expect(migrateTutorialProgress(null)).toBeUndefined()
    expect(migrateTutorialProgress({})).toBeUndefined()
    expect(migrateTutorialProgress({ active: true })).toBeUndefined()
  })

  it('accepts and clamps a stored record', () => {
    const inRange = migrateTutorialProgress({ stepIndex: 2 })
    const belowRange = migrateTutorialProgress({ stepIndex: -5 })
    expect(isLegacyTutorialProgress(inRange) && inRange).toMatchObject({ stepIndex: 2, active: true, done: false })
    expect(isLegacyTutorialProgress(belowRange) && belowRange).toMatchObject({ stepIndex: 0 })
    const past = migrateTutorialProgress({ stepIndex: 99 })
    expect(isLegacyTutorialProgress(past) && past.stepIndex).toBe(TUTORIAL_STEP_COUNT)
    expect(isLegacyTutorialProgress(past) && past.done).toBe(true)
  })

  it('keeps v1 records in their original seven-step format', () => {
    const old = { version: 1, active: true, stepIndex: 4, done: false }
    expect(migrateTutorialProgress(old)).toEqual(old)
  })

  it('round-trips v2 progress without remapping its stable action ID', () => {
    const progress = newTutorialProgressV2('scene-1')
    progress.currentActionId = 'camera.path'
    progress.actions['room.edit'] = {
      status: 'practiced', evidence: { kind: 'plan-corner-edit', sceneId: 'scene-1', subjectId: 'plan-1' },
    }
    expect(migrateTutorialProgress(progress)).toEqual(progress)
  })

  it('preserves unknown future tutorial versions without treating them as v1', () => {
    const future = { version: 3, currentActionId: 'future.action', custom: { retained: true } }
    expect(migrateTutorialProgress(future)).toEqual(future)
  })
})

describe('v2 lesson outcome evaluation', () => {
  it('requires each prerequisite and refuses evidence from another scene', () => {
    const progress = newTutorialProgressV2('scene-a')
    expect(evaluateTutorialAction('navigate.view', progress, { sceneId: 'scene-a' })).toEqual({
      state: 'prerequisite', actionId: 'intro.start',
    })
    expect(evaluateTutorialAction('navigate.view', progress, { sceneId: 'scene-b' })).toEqual({ state: 'wrong-scene' })
  })

  it('never re-locks export when the shot changes after a review', () => {
    const progress = newTutorialProgressV2('scene-a')
    progress.actions['finish.review'] = {
      status: 'confirmed', evidence: { kind: 'reviewed-current-shot', sceneId: 'scene-a', signature: 'shot-a' },
    }
    // The learner may continue whenever they like, so a stale review no longer
    // forces a re-review before export — export stays ready either way.
    expect(evaluateTutorialAction('finish.export', progress, { sceneId: 'scene-a' }).state).toBe('ready')
  })

  it('keeps skipped prerequisites explicit and offers an availability state', () => {
    let progress = newTutorialProgressV2('scene-a')
    progress = skipTutorialAction(progress, 'intro.start')
    expect(evaluateTutorialAction('navigate.view', progress, { sceneId: 'scene-a' })).toEqual({
      state: 'prerequisite-skipped', actionId: 'intro.start',
    })
    progress = recordTutorialAction(progress, 'intro.start', 'confirmed', {
      kind: 'started-project', sceneId: 'scene-a', subjectId: 'project-a',
    })
    expect(evaluateTutorialAction('navigate.view', progress, { sceneId: 'scene-a', availability: 'unavailable', unavailableReason: 'No touch control' })).toEqual({
      state: 'unavailable', reason: 'No touch control',
    })
  })

  it('allows the final save-and-return action after export is explicitly skipped', () => {
    const progress = {
      ...newTutorialProgressV2('scene-1'),
      currentActionId: 'finish.return',
      actions: { 'finish.export': { status: 'skipped' as const } },
    }
    useProjectStore.setState({
      workflow: { ...createLegacyProjectWorkflow('Tutorial'), tutorial: progress },
      activeSceneId: 'scene-1',
    })

    expect(evaluateTutorialAction('finish.return', progress, { sceneId: 'scene-1' }).state).toBe('ready')
    recordObservedTutorialAction('finish.return', {
      kind: 'project-saved-and-returned', sceneId: 'scene-1', subjectId: 'project-1',
    })
    const recorded = getTutorial()
    expect(isTutorialProgressV2(recorded) && recorded.actions['finish.return']?.status).toBe('practiced')
    advanceTutorialAction()
    const finished = getTutorial()
    expect(isTutorialProgressV2(finished) && finished.done).toBe(true)
  })

  it('keeps review/export done after a shot edit instead of re-locking', () => {
    const progress = newTutorialProgressV2('scene-a')
    progress.actions['finish.review'] = { status: 'confirmed', evidence: { kind: 'reviewed', sceneId: 'scene-a', signature: 'rev-1' } }
    progress.actions['finish.export'] = { status: 'practiced', evidence: { kind: 'file-offered', sceneId: 'scene-a', signature: 'rev-1' } }
    // A later shot edit used to reopen these steps (needs-recheck); the re-lock
    // is gone, so a completed step stays completed.
    expect(evaluateTutorialAction('finish.review', progress, { sceneId: 'scene-a' }).state).toBe('confirmed')
    expect(evaluateTutorialAction('finish.export', progress, { sceneId: 'scene-a' }).state).toBe('practiced')
  })
})

describe('v2 lesson controls', () => {
  it('lets Continue advance an un-practiced action, recording it as skipped', () => {
    seedV2Tutorial()
    // The learner never practices intro.start — they just press Continue.
    advanceTutorialAction()
    let progress = getTutorial()
    expect(isTutorialProgressV2(progress) && progress.currentActionId).toBe('navigate.view')
    expect(isTutorialProgressV2(progress) && progress.actions['intro.start']?.status).toBe('skipped')

    // A finished action keeps its status when Continue is pressed — the "done"
    // feedback survives rather than being overwritten with skipped. Practice
    // intro.start first so navigate.view's prerequisite is genuinely met.
    backTutorialAction()
    recordObservedTutorialAction('intro.start', { kind: 'started-project', sceneId: 'scene-1', subjectId: 'project-1' })
    advanceTutorialAction()
    confirmTutorialAction('navigate.view', 'scene-1')
    advanceTutorialAction()
    progress = getTutorial()
    expect(isTutorialProgressV2(progress) && progress.currentActionId).toBe('navigate.recover')
    expect(isTutorialProgressV2(progress) && progress.actions['navigate.view']?.status).toBe('confirmed')
  })

  it('requires current-scene evidence and explicit Continue while Back keeps practice', () => {
    seedV2Tutorial()
    confirmTutorialAction('intro.start', 'scene-1')
    recordObservedTutorialAction('intro.start', { kind: 'started-project', sceneId: 'other-scene', subjectId: 'project-x' })
    let progress = getTutorial()
    expect(isTutorialProgressV2(progress) && progress.actions['intro.start']).toBeUndefined()
    recordObservedTutorialAction('intro.start', { kind: 'started-project', sceneId: 'scene-1', subjectId: 'project-1' })
    advanceTutorialAction()
    progress = getTutorial()
    expect(isTutorialProgressV2(progress) && progress.currentActionId).toBe('navigate.view')
    confirmTutorialAction('navigate.view', 'scene-1')
    backTutorialAction()
    progress = getTutorial()
    expect(isTutorialProgressV2(progress) && progress.currentActionId).toBe('intro.start')
    expect(isTutorialProgressV2(progress) && progress.actions['navigate.view']?.status).toBe('confirmed')
  })

  it('preserves skipped actions and can pause/resume without resetting progress', () => {
    seedV2Tutorial()
    recordObservedTutorialAction('intro.start', { kind: 'started-project', sceneId: 'scene-1', subjectId: 'project-1' })
    advanceTutorialAction()
    skipCurrentTutorialAction()
    advanceTutorialAction()
    let progress = getTutorial()
    expect(isTutorialProgressV2(progress) && progress.currentActionId).toBe('navigate.recover')
    if (!isTutorialProgressV2(progress)) throw new Error('expected v2 tutorial')
    expect(evaluateTutorialAction('navigate.recover', progress, { sceneId: 'scene-1' }).state).toBe('prerequisite-skipped')
    pauseTutorial()
    expect(isTutorialActive()).toBe(false)
    resumeTutorial()
    progress = getTutorial()
    expect(isTutorialProgressV2(progress) && progress.active).toBe(true)
    expect(isTutorialProgressV2(progress) && progress.actions['navigate.view']?.status).toBe('skipped')
  })

  it('records a cancelled export distinctly so the learner can retry or skip', () => {
    seedV2Tutorial()
    const progress = getTutorial()
    if (!isTutorialProgressV2(progress)) throw new Error('expected v2 tutorial')
    useProjectStore.getState().setWorkflow({
      ...useProjectStore.getState().workflow,
      tutorial: {
        ...progress,
        currentActionId: 'finish.export',
        actions: {
          ...progress.actions,
          'finish.review': { status: 'confirmed', evidence: { kind: 'reviewed-current-shot', sceneId: 'scene-1', signature: 'shot-1' } },
        },
      },
    })

    recordTutorialExport('cancelled')

    const updated = getTutorial()
    expect(isTutorialProgressV2(updated) && updated.export.state).toBe('cancelled')
  })
})

describe('tutorial step engine', () => {
  it('advance/back/skip move the persisted progress', () => {
    seedTutorialWorkflow(0)
    expect(isTutorialActive()).toBe(true)
    advanceStep()
    expect(isLegacyTutorialProgress(getTutorial()) && getTutorial()?.version).toBe(1)
    const one = getTutorial()
    expect(isLegacyTutorialProgress(one) && one.stepIndex).toBe(1)
    backStep()
    const zero = getTutorial()
    expect(isLegacyTutorialProgress(zero) && zero.stepIndex).toBe(0)
    backStep() // clamped
    const stillZero = getTutorial()
    expect(isLegacyTutorialProgress(stillZero) && stillZero.stepIndex).toBe(0)
    skipTutorial()
    expect(isTutorialActive()).toBe(false)
    expect(getTutorial()).toBeDefined() // project stays a (skipped) tutorial
  })

  it('advancing past the last step finishes the tour', () => {
    seedTutorialWorkflow(TUTORIAL_STEP_COUNT - 1)
    advanceStep()
    const t = getTutorial()
    expect(t?.done).toBe(true)
    expect(t?.active).toBe(false)
    expect(isTutorialActive()).toBe(false)
  })

  it('does nothing on a non-tutorial project', () => {
    useProjectStore.setState({ workflow: createLegacyProjectWorkflow('normal') })
    expect(isTutorialActive()).toBe(false)
    advanceStep()
    expect(getTutorial()).toBeUndefined()
  })
})

describe('step detectors (absolute against a clean seed)', () => {
  it('welcome never auto-completes', () => {
    expect(step('welcome').isDone()).toBe(false)
  })

  it('plan completes when a scene object carries a copied plan graph', () => {
    expect(step('plan').isDone()).toBe(false)
    useSceneStore.setState({ objects: [{ plan: { walls: [], openings: [] } } as never] })
    expect(step('plan').isDone()).toBe(true)
  })

  it('figure completes when a dummy is present, ignoring primitives', () => {
    useSceneStore.setState({ objects: [{ primitive: { kind: 'box' } } as never] })
    expect(step('figure').isDone()).toBe(false)
    useSceneStore.setState({ objects: [{ rigKind: 'dummy', figureSex: 'female' } as never] })
    expect(step('figure').isDone()).toBe(true)
  })

  it('camera completes when a second option exists', () => {
    useCameraOptionsStore.setState({ options: [{ id: 'a' } as never] })
    expect(step('camera').isDone()).toBe(false)
    useCameraOptionsStore.setState({ options: [{ id: 'a' } as never, { id: 'b' } as never] })
    expect(step('camera').isDone()).toBe(true)
  })

  it('path completes only when finished with >=2 anchors', () => {
    usePathStore.setState({ paths: [{ id: 'p', anchors: [{}, {}] } as never], activePathId: 'p' })
    useEditorStore.setState({ tool: 'pen' })
    expect(step('path').isDone()).toBe(false) // still drawing
    useEditorStore.setState({ tool: 'select' })
    expect(step('path').isDone()).toBe(true)
  })

  it('keyframe completes when any rig key exists', () => {
    useRigStore.setState({ progressKeys: [] as never })
    expect(step('keyframe').isDone()).toBe(false)
    useRigStore.setState({ progressKeys: [{ t: 0.5, value: 0.5 }] as never })
    expect(step('keyframe').isDone()).toBe(true)
    useRigStore.setState({ progressKeys: [] as never })
  })

  it('export completes when the export flow is opened', () => {
    expect(step('export').isDone()).toBe(false)
    useEditorStore.setState({ exportMenuOpen: true })
    expect(step('export').isDone()).toBe(true)
  })
})
