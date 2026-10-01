import { useProjectStore } from '../../state/useProjectStore'
import { TUTORIAL_ACTIONS, TUTORIAL_STEPS } from './steps'
import {
  isLegacyTutorialProgress,
  isTutorialProgressV2,
  type TutorialProgress,
  tutorialPrerequisiteSatisfied,
} from './tutorialProgress'
import { bindTutorialArtifact as bindTutorialArtifactRecord, recordTutorialAction, skipTutorialAction } from './tutorialEvaluation'
import type { TutorialEvidence, TutorialExportState, TutorialArtifacts } from './tutorialProgress'

/**
 * Runtime control of the guided tutorial (issue #78). Progress lives in the open
 * project's `workflow.tutorial`; every mutation goes through `setWorkflow`, which
 * persists via the existing autosave. Seeding a tutorial project lives in
 * `lib/projects.ts` (`startTutorial` / `replayTutorial`) where the record
 * machinery is; this module owns advance / back / skip and reads.
 */

const STEP_COUNT = TUTORIAL_STEPS.length

/** The open project's tutorial progress, or undefined for a normal project. */
export function getTutorial(): TutorialProgress | undefined {
  return useProjectStore.getState().workflow.tutorial
}

/** The tour is showing (a tutorial project whose lesson has not been skipped/finished). */
export function isTutorialActive(): boolean {
  const t = getTutorial()
  return Boolean((isLegacyTutorialProgress(t) || isTutorialProgressV2(t)) && t.active && !t.done)
}

function patchTutorial(next: TutorialProgress): void {
  const store = useProjectStore.getState()
  store.setWorkflow({ ...store.workflow, tutorial: next })
}

/** Move to the next step; advancing past the last step finishes the tour. */
export function advanceStep(): void {
  const t = getTutorial()
  if (!isLegacyTutorialProgress(t) || !t.active) return
  const nextIndex = t.stepIndex + 1
  if (nextIndex >= STEP_COUNT) {
    patchTutorial({ ...t, stepIndex: STEP_COUNT, active: false, done: true })
  } else {
    patchTutorial({ ...t, stepIndex: nextIndex })
  }
}

/** Move to the previous step. Never reverses edits the user has made. */
export function backStep(): void {
  const t = getTutorial()
  if (!isLegacyTutorialProgress(t) || !t.active) return
  if (t.stepIndex <= 0) return
  patchTutorial({ ...t, stepIndex: t.stepIndex - 1, done: false })
}

/** Exit the tour, preserving the project and everything created so far. */
export function skipTutorial(): void {
  const t = getTutorial()
  if (!isLegacyTutorialProgress(t) && !isTutorialProgressV2(t)) return
  patchTutorial({ ...t, active: false })
}

export function pauseTutorial(): void {
  const t = getTutorial()
  if (!isTutorialProgressV2(t) || !t.active) return
  patchTutorial({ ...t, active: false })
}

export function resumeTutorial(): void {
  const t = getTutorial()
  if (!isTutorialProgressV2(t) || t.done || t.active) return
  patchTutorial({ ...t, active: true })
}

export function confirmTutorialAction(actionId: string, sceneId: string, signature?: string): void {
  const t = getTutorial()
  if (!isTutorialProgressV2(t) || !t.active || t.currentActionId !== actionId || sceneId !== t.sceneId) return
  const definition = TUTORIAL_ACTIONS.find((item) => item.id === actionId)
  if (definition?.completion !== 'confirmation') return
  if (!definition || definition.prerequisites.some((id) => !tutorialPrerequisiteSatisfied(t, actionId, id))) return
  patchTutorial(recordTutorialAction(t, actionId, 'confirmed', {
    kind: actionId === 'finish.review' ? 'reviewed-current-shot' : 'learner-confirmed-practice',
    sceneId,
    ...(signature ? { signature } : {}),
    at: Date.now(),
  }))
}

/** Record an outcome observed from this lesson's actual app state. */
export function recordObservedTutorialAction(actionId: string, evidence: TutorialEvidence): void {
  const t = getTutorial()
  if (!isTutorialProgressV2(t) || !t.active || t.currentActionId !== actionId || evidence.sceneId !== t.sceneId) return
  const definition = TUTORIAL_ACTIONS.find((item) => item.id === actionId)
  if (definition?.completion !== 'practice') return
  const existing = t.actions[actionId]
  if ((existing?.status === 'practiced' || existing?.status === 'confirmed')
    && !(actionId === 'finish.export' && existing.evidence?.signature !== evidence.signature)) return
  if (definition.prerequisites.some((id) => !tutorialPrerequisiteSatisfied(t, actionId, id))) return
  patchTutorial(recordTutorialAction(t, actionId, 'practiced', { ...evidence, at: evidence.at ?? Date.now() }))
}

export function bindTutorialArtifact<K extends keyof TutorialArtifacts>(key: K, id: string): void {
  const t = getTutorial()
  if (!isTutorialProgressV2(t) || !t.active) return
  patchTutorial(bindTutorialArtifactRecord(t, key, id))
}

export function recordTutorialExport(
  state: TutorialExportState,
  result: { fileName?: string; byteSize?: number; signature?: string } = {},
): void {
  const t = getTutorial()
  if (!isTutorialProgressV2(t) || !t.active || t.currentActionId !== 'finish.export') return
  patchTutorial({
    ...t,
    export: {
      state,
      sceneId: t.sceneId,
      ...(result.fileName ? { fileName: result.fileName } : {}),
      ...(Number.isFinite(result.byteSize) ? { byteSize: result.byteSize } : {}),
      ...(result.signature ? { signature: result.signature } : {}),
    },
  })
}

export function skipCurrentTutorialAction(): void {
  const t = getTutorial()
  if (!isTutorialProgressV2(t) || !t.active) return
  const next = skipTutorialAction(t, t.currentActionId)
  patchTutorial({
    ...next,
    ...(t.currentActionId === 'finish.export' ? { export: { state: 'skipped', sceneId: t.sceneId } as const } : {}),
  })
}

/**
 * Move to the next action. Continue is never gated on completing the current
 * action: the learner may advance whenever they like. An action they never
 * practiced or confirmed is recorded as `skipped` so progress stays honest and
 * dependent actions still see it as skipped; a practiced/confirmed status is
 * left untouched so its "done" feedback survives. Skipping the optional export
 * this way also marks the export itself skipped, mirroring an explicit skip.
 */
export function advanceTutorialAction(): void {
  const t = getTutorial()
  if (!isTutorialProgressV2(t) || !t.active) return
  const currentIndex = TUTORIAL_ACTIONS.findIndex((action) => action.id === t.currentActionId)
  if (currentIndex < 0) return
  const currentStatus = t.actions[t.currentActionId]?.status
  const completed = currentStatus === 'practiced' || currentStatus === 'confirmed' || currentStatus === 'skipped'
  const base = completed
    ? t
    : {
        ...skipTutorialAction(t, t.currentActionId),
        ...(t.currentActionId === 'finish.export' ? { export: { state: 'skipped', sceneId: t.sceneId } as const } : {}),
      }
  const next = TUTORIAL_ACTIONS[currentIndex + 1]
  if (!next) {
    patchTutorial({ ...base, active: false, done: true })
    return
  }
  patchTutorial({ ...base, currentActionId: next.id })
}

export function backTutorialAction(): void {
  const t = getTutorial()
  if (!isTutorialProgressV2(t) || !t.active) return
  const currentIndex = TUTORIAL_ACTIONS.findIndex((action) => action.id === t.currentActionId)
  const previous = currentIndex > 0 ? TUTORIAL_ACTIONS[currentIndex - 1] : undefined
  if (previous) patchTutorial({ ...t, currentActionId: previous.id, done: false })
}
