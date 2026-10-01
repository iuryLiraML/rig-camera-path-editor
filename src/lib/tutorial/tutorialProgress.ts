/** Project-scoped tutorial state. Unknown versions are retained, never executed. */

export const LEGACY_TUTORIAL_VERSION = 1 as const
export const TUTORIAL_VERSION = 2 as const
export const TUTORIAL_CURRICULUM_ID = 'first-camera-move' as const
export const TUTORIAL_CURRICULUM_REVISION = 1 as const

export type TutorialActionStatus = 'practiced' | 'confirmed' | 'skipped'

export interface TutorialEvidence {
  kind: string
  sceneId: string
  subjectId?: string
  signature?: string
  at?: number
}

export interface TutorialActionRecord {
  status: TutorialActionStatus
  evidence?: TutorialEvidence
}

export interface TutorialArtifacts {
  practiceCubeId?: string
  planAssetId?: string
  planObjectId?: string
  figureId?: string
  cameraOptionId?: string
  pathId?: string
}

export type TutorialExportState =
  | 'not-attempted'
  | 'setup-ready'
  | 'file-offered'
  | 'cancelled'
  | 'failed'
  | 'skipped'
  | 'unsupported'

export interface TutorialExportRecord {
  state: TutorialExportState
  sceneId?: string
  signature?: string
  fileName?: string
  byteSize?: number
}

/** Original seven-step record. Keep its meaning stable for existing projects. */
export interface LegacyTutorialProgress {
  version: typeof LEGACY_TUTORIAL_VERSION
  active: boolean
  stepIndex: number
  done: boolean
}

/** New practical curriculum, keyed by action ID rather than positional index. */
export interface TutorialProgressV2 {
  version: typeof TUTORIAL_VERSION
  curriculumId: typeof TUTORIAL_CURRICULUM_ID
  curriculumRevision: typeof TUTORIAL_CURRICULUM_REVISION
  active: boolean
  currentActionId: string
  sceneId: string
  artifacts: TutorialArtifacts
  actions: Record<string, TutorialActionRecord>
  export: TutorialExportRecord
  /** Reached the summary; this does not claim all actions were practiced. */
  done: boolean
}

/** A deliberately skipped export still permits the final save-and-return action. */
export function tutorialPrerequisiteSatisfied(
  progress: Pick<TutorialProgressV2, 'actions'>,
  actionId: string,
  prerequisiteId: string,
): boolean {
  const status = progress.actions[prerequisiteId]?.status
  return status === 'practiced' || status === 'confirmed'
    || (actionId === 'finish.return' && prerequisiteId === 'finish.export' && status === 'skipped')
}

/** Forward-compatible payload. Preserve it through project saves without running it. */
export interface UnknownTutorialProgress {
  version: number
  [key: string]: unknown
}

export type TutorialProgress = LegacyTutorialProgress | TutorialProgressV2 | UnknownTutorialProgress

/** Retained for explicit v1 replay and compatibility tests only. */
export const TUTORIAL_STEP_COUNT = 7

export function newTutorialProgress(): LegacyTutorialProgress {
  return { version: LEGACY_TUTORIAL_VERSION, active: true, stepIndex: 0, done: false }
}

export function newTutorialProgressV2(sceneId: string): TutorialProgressV2 {
  return {
    version: TUTORIAL_VERSION,
    curriculumId: TUTORIAL_CURRICULUM_ID,
    curriculumRevision: TUTORIAL_CURRICULUM_REVISION,
    active: true,
    currentActionId: 'intro.result',
    sceneId,
    artifacts: {},
    actions: {},
    export: { state: 'not-attempted' },
    done: false,
  }
}

export function isLegacyTutorialProgress(value: TutorialProgress | undefined): value is LegacyTutorialProgress {
  return value?.version === LEGACY_TUTORIAL_VERSION && 'stepIndex' in value
}

export function isTutorialProgressV2(value: TutorialProgress | undefined): value is TutorialProgressV2 {
  return value?.version === TUTORIAL_VERSION && 'currentActionId' in value
}

/**
 * Migrate untrusted persisted data without turning ordinary projects into tutorials.
 * V1's tolerant, clamped step-index reader is intentionally frozen. V2 uses stable
 * IDs, and a future version is passed through unchanged for forward compatibility.
 */
export function migrateTutorialProgress(value: unknown): TutorialProgress | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const version = typeof record.version === 'number' ? record.version : LEGACY_TUTORIAL_VERSION

  if (version === LEGACY_TUTORIAL_VERSION) {
    if (typeof record.stepIndex !== 'number' || !Number.isFinite(record.stepIndex)) return undefined
    const stepIndex = Math.max(0, Math.min(TUTORIAL_STEP_COUNT, Math.floor(record.stepIndex)))
    return {
      version: LEGACY_TUTORIAL_VERSION,
      active: record.active !== false,
      stepIndex,
      done: record.done === true || stepIndex >= TUTORIAL_STEP_COUNT,
    }
  }

  if (version === TUTORIAL_VERSION) {
    if (
      record.curriculumId !== TUTORIAL_CURRICULUM_ID ||
      !Number.isInteger(record.curriculumRevision) ||
      typeof record.currentActionId !== 'string' ||
      typeof record.sceneId !== 'string' ||
      !record.sceneId ||
      typeof record.active !== 'boolean' ||
      typeof record.done !== 'boolean'
    ) return undefined

    const actions: Record<string, TutorialActionRecord> = {}
    if (typeof record.actions === 'object' && record.actions !== null && !Array.isArray(record.actions)) {
      for (const [id, raw] of Object.entries(record.actions as Record<string, unknown>)) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
        const action = raw as Record<string, unknown>
        if (action.status !== 'practiced' && action.status !== 'confirmed' && action.status !== 'skipped') continue
        let evidence: TutorialEvidence | undefined
        if (typeof action.evidence === 'object' && action.evidence !== null && !Array.isArray(action.evidence)) {
          const candidate = action.evidence as Record<string, unknown>
          if (typeof candidate.kind === 'string' && candidate.sceneId === record.sceneId) {
            evidence = {
              kind: candidate.kind,
              sceneId: record.sceneId,
              ...(typeof candidate.subjectId === 'string' ? { subjectId: candidate.subjectId } : {}),
              ...(typeof candidate.signature === 'string' ? { signature: candidate.signature } : {}),
              ...(typeof candidate.at === 'number' && Number.isFinite(candidate.at) ? { at: candidate.at } : {}),
            }
          }
        }
        actions[id] = { status: action.status, ...(evidence ? { evidence } : {}) }
      }
    }

    const rawArtifacts = typeof record.artifacts === 'object' && record.artifacts !== null && !Array.isArray(record.artifacts)
      ? record.artifacts as Record<string, unknown>
      : {}
    const artifacts: TutorialArtifacts = {}
    for (const key of ['practiceCubeId', 'planAssetId', 'planObjectId', 'figureId', 'cameraOptionId', 'pathId'] as const) {
      if (typeof rawArtifacts[key] === 'string') artifacts[key] = rawArtifacts[key]
    }

    const rawExport = typeof record.export === 'object' && record.export !== null && !Array.isArray(record.export)
      ? record.export as Record<string, unknown>
      : {}
    const states: TutorialExportState[] = ['not-attempted', 'setup-ready', 'file-offered', 'cancelled', 'failed', 'skipped', 'unsupported']
    const exportRecord: TutorialExportRecord = {
      state: states.includes(rawExport.state as TutorialExportState) ? rawExport.state as TutorialExportState : 'not-attempted',
      ...(typeof rawExport.sceneId === 'string' ? { sceneId: rawExport.sceneId } : {}),
      ...(typeof rawExport.signature === 'string' ? { signature: rawExport.signature } : {}),
      ...(typeof rawExport.fileName === 'string' ? { fileName: rawExport.fileName } : {}),
      ...(typeof rawExport.byteSize === 'number' && Number.isFinite(rawExport.byteSize) ? { byteSize: rawExport.byteSize } : {}),
    }

    return {
      version: TUTORIAL_VERSION,
      curriculumId: TUTORIAL_CURRICULUM_ID,
      curriculumRevision: TUTORIAL_CURRICULUM_REVISION,
      active: record.active,
      currentActionId: record.currentActionId,
      sceneId: record.sceneId,
      artifacts,
      actions,
      export: exportRecord,
      done: record.done,
    }
  }

  if (Number.isFinite(version) && version > TUTORIAL_VERSION) {
    return { ...record, version } as UnknownTutorialProgress
  }
  return undefined
}
