import { TUTORIAL_ACTIONS } from './steps'
import { tutorialPrerequisiteSatisfied } from './tutorialProgress'
import type {
  TutorialActionRecord,
  TutorialActionStatus,
  TutorialEvidence,
  TutorialProgressV2,
} from './tutorialProgress'

export type TutorialAvailability = 'ready' | 'loading' | 'unavailable'

export interface TutorialActionContext {
  sceneId: string
  availability?: TutorialAvailability
  unavailableReason?: string
}

export type TutorialActionEvaluation =
  | { state: 'unknown-action' }
  | { state: 'wrong-scene' }
  | { state: 'prerequisite'; actionId: string }
  | { state: 'prerequisite-skipped'; actionId: string }
  | { state: 'loading' }
  | { state: 'unavailable'; reason?: string }
  | { state: 'ready' }
  | { state: 'practiced'; evidence?: TutorialEvidence }
  | { state: 'confirmed'; evidence?: TutorialEvidence }
  | { state: 'skipped' }

function currentRecord(progress: TutorialProgressV2, actionId: string): TutorialActionRecord | undefined {
  return progress.actions[actionId]
}

export function evaluateTutorialAction(
  actionId: string,
  progress: TutorialProgressV2,
  context: TutorialActionContext,
): TutorialActionEvaluation {
  const definition = TUTORIAL_ACTIONS.find((item) => item.id === actionId)
  if (!definition) return { state: 'unknown-action' }
  if (context.sceneId !== progress.sceneId) return { state: 'wrong-scene' }

  const record = currentRecord(progress, actionId)
  if (record?.status === 'skipped') return { state: 'skipped' }
  if (record?.status === 'practiced') return { state: 'practiced', evidence: record.evidence }
  if (record?.status === 'confirmed') return { state: 'confirmed', evidence: record.evidence }

  for (const prerequisite of definition.prerequisites) {
    const status = progress.actions[prerequisite]?.status
    if (tutorialPrerequisiteSatisfied(progress, actionId, prerequisite)) continue
    if (status === 'skipped') return { state: 'prerequisite-skipped', actionId: prerequisite }
    if (status !== 'practiced' && status !== 'confirmed') return { state: 'prerequisite', actionId: prerequisite }
  }

  if (context.availability === 'loading') return { state: 'loading' }
  if (context.availability === 'unavailable') return { state: 'unavailable', reason: context.unavailableReason }
  return { state: 'ready' }
}

export function recordTutorialAction(
  progress: TutorialProgressV2,
  actionId: string,
  status: Exclude<TutorialActionStatus, 'skipped'>,
  evidence: TutorialEvidence,
): TutorialProgressV2 {
  if (!TUTORIAL_ACTIONS.some((item) => item.id === actionId)) return progress
  if (evidence.sceneId !== progress.sceneId || !evidence.kind) return progress
  if (status === 'practiced' && !evidence.subjectId && !evidence.signature && evidence.kind === 'acknowledgement') {
    return progress
  }
  return {
    ...progress,
    actions: { ...progress.actions, [actionId]: { status, evidence } },
  }
}

export function skipTutorialAction(progress: TutorialProgressV2, actionId: string): TutorialProgressV2 {
  if (!TUTORIAL_ACTIONS.some((item) => item.id === actionId)) return progress
  return { ...progress, actions: { ...progress.actions, [actionId]: { status: 'skipped' } } }
}

export function bindTutorialArtifact<K extends keyof TutorialProgressV2['artifacts']>(
  progress: TutorialProgressV2,
  key: K,
  id: string,
): TutorialProgressV2 {
  if (!id.trim()) return progress
  return { ...progress, artifacts: { ...progress.artifacts, [key]: id } }
}

export function setTutorialCurrentAction(progress: TutorialProgressV2, actionId: string): TutorialProgressV2 {
  if (!TUTORIAL_ACTIONS.some((item) => item.id === actionId)) return progress
  return { ...progress, currentActionId: actionId }
}
