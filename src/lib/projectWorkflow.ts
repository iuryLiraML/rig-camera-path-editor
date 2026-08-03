export const PROJECT_WORKFLOW_VERSION = 1 as const

export type ArtifactStatus =
  | 'missing'
  | 'draft'
  | 'generating'
  | 'review-required'
  | 'approved'
  | 'stale'
  | 'failed'

export type IntakeStep = 'foundation' | 'brief-source' | 'interview' | 'summary'

export interface ProjectFoundation {
  status: 'draft' | 'complete'
  client: string
  deliverable: string
  targetChannels: string[]
  targetDurationSeconds: number | null
}

export type BriefSourceContentType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'text/plain'
  | 'text/markdown'

export interface BriefSourceRecord {
  status: 'missing' | 'ready'
  fileName: string | null
  contentType: BriefSourceContentType | null
  extractedText: string
  sha256: string | null
  parsedAt: string | null
  cloudAssetId: string | null
}

export interface InterviewTurn {
  role: 'director' | 'client'
  text: string
  at: string
}

export interface ProjectInterview {
  status: 'not-started' | 'in-progress' | 'complete'
  transcript: InterviewTurn[]
}

export interface CreativeBriefArtifact {
  status: ArtifactStatus
  draft: string | null
  approvedAt: string | null
}

export type SceneAssetContentType = 'model/gltf-binary' | 'model/gltf+json'

export interface SceneAssetRecord {
  id: string
  sceneObjectId: string
  fileName: string
  contentType: SceneAssetContentType
  byteSize: number
  sha256: string
  cloudAssetId: string | null
  importedAt: string
}

export interface SceneAssetsArtifact {
  status: ArtifactStatus
  primaryAssetId: string | null
  assets: SceneAssetRecord[]
}

export interface SubjectProposal {
  sceneObjectId: string
  objectName: string
  focusSummary: string
}

export interface SubjectsArtifact {
  status: ArtifactStatus
  proposal: SubjectProposal | null
  approvedAt: string | null
}

export interface GuidelinesArtifact {
  status: ArtifactStatus
  draft: string | null
  skillName: string | null
  skillBody: string | null
  skillId: string | null
  approvedAt: string | null
}

export interface PrdArtifact {
  status: ArtifactStatus
  draft: string | null
  approvedAt: string | null
}

export const CAMERA_PROFILES = [
  'packshot',
  'reveal-orbit',
  'dolly',
  'fpv-drone',
  'custom',
] as const

export type CameraProfile = (typeof CAMERA_PROFILES)[number]

export interface PlannedShot {
  id: string
  order: number
  name: string
  profile: CameraProfile
  durationSeconds: number
  intent: string
  framingNotes: string
  constraints: string[]
}

export interface ShotListArtifact {
  status: ArtifactStatus
  revision: number
  /** Stable cloud artifact id used when enqueueing camera-batch jobs. */
  artifactId: string | null
  shots: PlannedShot[]
  summary: string | null
  approvedAt: string | null
}

export interface ProjectWorkflow {
  schemaVersion: typeof PROJECT_WORKFLOW_VERSION
  /** Existing local projects retain editor access while their artifacts are migrated deliberately. */
  legacyEditorAccess: boolean
  intake: {
    status: 'draft' | 'approved'
    currentStep: IntakeStep
  }
  foundation: ProjectFoundation
  briefSource: BriefSourceRecord
  interview: ProjectInterview
  brief: CreativeBriefArtifact
  sceneAssets: SceneAssetsArtifact
  subjects: SubjectsArtifact
  guidelines: GuidelinesArtifact
  prd: PrdArtifact
  shotList: ShotListArtifact
}

export type RequiredProjectAction =
  | 'foundation'
  | 'brief-source'
  | 'interview'
  | 'brief-review'
  | 'asset-intake'
  | 'subject-confirmation'
  | 'guidelines-review'
  | 'prd-review'
  | 'shot-list-review'
  | 'editor'

export interface FoundationErrors {
  client?: string
  deliverable?: string
  targetDurationSeconds?: string
}

export interface BriefSourceErrors {
  extractedText?: string
}

export interface AssetIntakeErrors {
  primaryAssetId?: string
  assets?: string
}

export interface ShotListErrors {
  shots?: string
}

export type CompleteFoundationResult =
  | { ok: true; workflow: ProjectWorkflow }
  | { ok: false; errors: FoundationErrors }

export type CompleteBriefSourceResult =
  | { ok: true; workflow: ProjectWorkflow }
  | { ok: false; errors: BriefSourceErrors }

export type CompleteAssetIntakeResult =
  | { ok: true; workflow: ProjectWorkflow }
  | { ok: false; errors: AssetIntakeErrors }

export type ApproveShotListResult =
  | { ok: true; workflow: ProjectWorkflow }
  | { ok: false; errors: ShotListErrors }

function emptyBriefSource(): BriefSourceRecord {
  return {
    status: 'missing',
    fileName: null,
    contentType: null,
    extractedText: '',
    sha256: null,
    parsedAt: null,
    cloudAssetId: null,
  }
}

function emptyInterview(): ProjectInterview {
  return { status: 'not-started', transcript: [] }
}

function emptyBrief(): CreativeBriefArtifact {
  return { status: 'missing', draft: null, approvedAt: null }
}

function emptySceneAssets(): SceneAssetsArtifact {
  return { status: 'missing', primaryAssetId: null, assets: [] }
}

function emptySubjects(): SubjectsArtifact {
  return { status: 'missing', proposal: null, approvedAt: null }
}

function emptyGuidelines(): GuidelinesArtifact {
  return {
    status: 'missing',
    draft: null,
    skillName: null,
    skillBody: null,
    skillId: null,
    approvedAt: null,
  }
}

function emptyPrd(): PrdArtifact {
  return { status: 'missing', draft: null, approvedAt: null }
}

function emptyShotList(): ShotListArtifact {
  return {
    status: 'missing',
    revision: 0,
    artifactId: null,
    shots: [],
    summary: null,
    approvedAt: null,
  }
}

function emptyArtifacts() {
  return {
    briefSource: emptyBriefSource(),
    interview: emptyInterview(),
    brief: emptyBrief(),
    sceneAssets: emptySceneAssets(),
    subjects: emptySubjects(),
    guidelines: emptyGuidelines(),
    prd: emptyPrd(),
    shotList: emptyShotList(),
  }
}

function isArtifactStatus(value: unknown): value is ArtifactStatus {
  return (
    value === 'missing' ||
    value === 'draft' ||
    value === 'generating' ||
    value === 'review-required' ||
    value === 'approved' ||
    value === 'stale' ||
    value === 'failed'
  )
}

function artifactStatus(value: unknown): ArtifactStatus {
  if (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    isArtifactStatus(value.status)
  ) {
    // 'generating' only describes an in-flight request, and the 800 ms autosave
    // can persist it. Rehydrating it would strand the step in a state no
    // in-page action clears, so recover to something actionable instead.
    if (value.status === 'generating') {
      const hasDraft =
        'draft' in value && typeof (value as { draft?: unknown }).draft === 'string' &&
        ((value as { draft: string }).draft.trim().length > 0)
      return hasDraft ? 'review-required' : 'missing'
    }
    return value.status
  }
  return 'missing'
}

function sceneAssetsArtifact(value: unknown): SceneAssetsArtifact {
  if (typeof value !== 'object' || value === null) return emptySceneAssets()
  const candidate = value as Partial<SceneAssetsArtifact>
  const assets = Array.isArray(candidate.assets)
    ? candidate.assets.filter(
        (asset): asset is SceneAssetRecord =>
          typeof asset === 'object' &&
          asset !== null &&
          typeof asset.id === 'string' &&
          typeof asset.sceneObjectId === 'string' &&
          typeof asset.fileName === 'string' &&
          (asset.contentType === 'model/gltf-binary' ||
            asset.contentType === 'model/gltf+json') &&
          typeof asset.byteSize === 'number' &&
          typeof asset.sha256 === 'string' &&
          typeof asset.importedAt === 'string',
      )
    : []
  return {
    status: artifactStatus(value),
    primaryAssetId:
      typeof candidate.primaryAssetId === 'string' ? candidate.primaryAssetId : null,
    assets,
  }
}

function subjectsArtifact(value: unknown): SubjectsArtifact {
  if (typeof value !== 'object' || value === null) return emptySubjects()
  const candidate = value as Partial<SubjectsArtifact>
  const proposal = candidate.proposal
  const migratedProposal: SubjectProposal | null =
    typeof proposal === 'object' &&
    proposal !== null &&
    typeof proposal.sceneObjectId === 'string' &&
    typeof proposal.objectName === 'string' &&
    typeof proposal.focusSummary === 'string'
      ? {
          sceneObjectId: proposal.sceneObjectId,
          objectName: proposal.objectName,
          focusSummary: proposal.focusSummary,
        }
      : null
  return {
    status: artifactStatus(value),
    proposal: migratedProposal,
    approvedAt: typeof candidate.approvedAt === 'string' ? candidate.approvedAt : null,
  }
}

function guidelinesArtifact(value: unknown): GuidelinesArtifact {
  if (typeof value !== 'object' || value === null) return emptyGuidelines()
  const candidate = value as Partial<GuidelinesArtifact>
  return {
    status: artifactStatus(value),
    draft: typeof candidate.draft === 'string' ? candidate.draft : null,
    skillName: typeof candidate.skillName === 'string' ? candidate.skillName : null,
    skillBody: typeof candidate.skillBody === 'string' ? candidate.skillBody : null,
    skillId: typeof candidate.skillId === 'string' ? candidate.skillId : null,
    approvedAt: typeof candidate.approvedAt === 'string' ? candidate.approvedAt : null,
  }
}

function prdArtifact(value: unknown): PrdArtifact {
  if (typeof value !== 'object' || value === null) return emptyPrd()
  const candidate = value as Partial<PrdArtifact>
  return {
    status: artifactStatus(value),
    draft: typeof candidate.draft === 'string' ? candidate.draft : null,
    approvedAt: typeof candidate.approvedAt === 'string' ? candidate.approvedAt : null,
  }
}

function isCameraProfile(value: unknown): value is CameraProfile {
  return (
    value === 'packshot' ||
    value === 'reveal-orbit' ||
    value === 'dolly' ||
    value === 'fpv-drone' ||
    value === 'custom'
  )
}

function plannedShot(value: unknown, index: number): PlannedShot | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<PlannedShot>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.name !== 'string' ||
    !isCameraProfile(candidate.profile) ||
    typeof candidate.intent !== 'string'
  ) {
    return null
  }
  const duration =
    typeof candidate.durationSeconds === 'number' &&
    Number.isFinite(candidate.durationSeconds) &&
    candidate.durationSeconds > 0
      ? candidate.durationSeconds
      : 4
  return {
    id: candidate.id,
    order: typeof candidate.order === 'number' ? candidate.order : index,
    name: candidate.name,
    profile: candidate.profile,
    durationSeconds: duration,
    intent: candidate.intent,
    framingNotes: typeof candidate.framingNotes === 'string' ? candidate.framingNotes : '',
    constraints: Array.isArray(candidate.constraints)
      ? candidate.constraints.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

function shotListArtifact(value: unknown): ShotListArtifact {
  if (typeof value !== 'object' || value === null) return emptyShotList()
  const candidate = value as Partial<ShotListArtifact>
  const shots = Array.isArray(candidate.shots)
    ? candidate.shots
        .map((shot, index) => plannedShot(shot, index))
        .filter((shot): shot is PlannedShot => shot !== null)
    : []
  return {
    status: artifactStatus(value),
    revision:
      typeof candidate.revision === 'number' && candidate.revision >= 0
        ? Math.floor(candidate.revision)
        : shots.length > 0
          ? 1
          : 0,
    artifactId: typeof candidate.artifactId === 'string' ? candidate.artifactId : null,
    shots,
    summary: typeof candidate.summary === 'string' ? candidate.summary : null,
    approvedAt: typeof candidate.approvedAt === 'string' ? candidate.approvedAt : null,
  }
}

function briefArtifact(value: unknown): CreativeBriefArtifact {
  if (typeof value !== 'object' || value === null) return emptyBrief()
  const candidate = value as Partial<CreativeBriefArtifact>
  return {
    status: artifactStatus(value),
    draft: typeof candidate.draft === 'string' ? candidate.draft : null,
    approvedAt: typeof candidate.approvedAt === 'string' ? candidate.approvedAt : null,
  }
}

function interviewArtifact(value: unknown): ProjectInterview {
  if (typeof value !== 'object' || value === null) return emptyInterview()
  const candidate = value as Partial<ProjectInterview>
  const transcript = Array.isArray(candidate.transcript)
    ? candidate.transcript
        .filter(
          (turn): turn is InterviewTurn =>
            typeof turn === 'object' &&
            turn !== null &&
            (turn.role === 'director' || turn.role === 'client') &&
            typeof turn.text === 'string' &&
            typeof turn.at === 'string',
        )
    : []
  const status =
    candidate.status === 'in-progress' || candidate.status === 'complete'
      ? candidate.status
      : transcript.length > 0
        ? 'in-progress'
        : 'not-started'
  return { status, transcript }
}

/** Runtime migration seam for untrusted IndexedDB or future server records. */
export function migrateProjectWorkflow(value: unknown, projectName: string): ProjectWorkflow {
  if (value === undefined) return createLegacyProjectWorkflow(projectName)
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) {
    return createProjectWorkflow(projectName)
  }
  if (value.schemaVersion !== PROJECT_WORKFLOW_VERSION) return createProjectWorkflow(projectName)

  const candidate = value as Partial<ProjectWorkflow>
  const foundation = candidate.foundation
  const intake = candidate.intake
  if (
    typeof candidate.legacyEditorAccess !== 'boolean' ||
    typeof foundation !== 'object' ||
    foundation === null ||
    typeof intake !== 'object' ||
    intake === null
  ) {
    return createProjectWorkflow(projectName)
  }

  const foundationStatus = foundation.status === 'complete' ? 'complete' : 'draft'
  const currentStep: IntakeStep =
    intake.currentStep === 'brief-source' ||
    intake.currentStep === 'interview' ||
    intake.currentStep === 'summary'
      ? intake.currentStep
      : 'foundation'

  const briefSource = candidate.briefSource
  const migratedBriefSource: BriefSourceRecord =
    typeof briefSource === 'object' &&
    briefSource !== null &&
    briefSource.status === 'ready' &&
    typeof briefSource.extractedText === 'string' &&
    briefSource.extractedText.trim().length > 0
      ? {
          status: 'ready',
          fileName: typeof briefSource.fileName === 'string' ? briefSource.fileName : null,
          contentType:
            briefSource.contentType === 'application/pdf' ||
            briefSource.contentType ===
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            briefSource.contentType === 'text/plain' ||
            briefSource.contentType === 'text/markdown'
              ? briefSource.contentType
              : null,
          extractedText: briefSource.extractedText,
          sha256: typeof briefSource.sha256 === 'string' ? briefSource.sha256 : null,
          parsedAt: typeof briefSource.parsedAt === 'string' ? briefSource.parsedAt : null,
          cloudAssetId:
            typeof briefSource.cloudAssetId === 'string' ? briefSource.cloudAssetId : null,
        }
      : emptyBriefSource()

  return {
    schemaVersion: PROJECT_WORKFLOW_VERSION,
    legacyEditorAccess: candidate.legacyEditorAccess,
    intake: {
      status: intake.status === 'approved' ? 'approved' : 'draft',
      currentStep,
    },
    foundation: {
      status: foundationStatus,
      client: typeof foundation.client === 'string' ? foundation.client : '',
      deliverable: typeof foundation.deliverable === 'string' ? foundation.deliverable : '',
      targetChannels: Array.isArray(foundation.targetChannels)
        ? foundation.targetChannels.filter((channel): channel is string => typeof channel === 'string')
        : [],
      targetDurationSeconds:
        typeof foundation.targetDurationSeconds === 'number' &&
        Number.isFinite(foundation.targetDurationSeconds)
          ? foundation.targetDurationSeconds
          : null,
    },
    briefSource: migratedBriefSource,
    interview: interviewArtifact(candidate.interview),
    brief: briefArtifact(candidate.brief),
    sceneAssets: sceneAssetsArtifact(candidate.sceneAssets),
    subjects: subjectsArtifact(candidate.subjects),
    guidelines: guidelinesArtifact(candidate.guidelines),
    prd: prdArtifact(candidate.prd),
    shotList: shotListArtifact(candidate.shotList),
  }
}

export function createProjectWorkflow(_projectName: string): ProjectWorkflow {
  return {
    schemaVersion: PROJECT_WORKFLOW_VERSION,
    legacyEditorAccess: false,
    intake: {
      status: 'draft',
      currentStep: 'foundation',
    },
    foundation: {
      status: 'draft',
      client: '',
      deliverable: '',
      targetChannels: [],
      targetDurationSeconds: null,
    },
    ...emptyArtifacts(),
  }
}

export function createLegacyProjectWorkflow(_projectName: string): ProjectWorkflow {
  return {
    ...createProjectWorkflow(_projectName),
    legacyEditorAccess: true,
  }
}

export function updateProjectFoundation(
  workflow: ProjectWorkflow,
  patch: Partial<Omit<ProjectFoundation, 'status'>>,
): ProjectWorkflow {
  return {
    ...workflow,
    foundation: {
      ...workflow.foundation,
      ...patch,
      status: 'draft',
    },
  }
}

export function validateProjectFoundation(foundation: ProjectFoundation): FoundationErrors {
  const errors: FoundationErrors = {}
  if (!foundation.client.trim()) errors.client = 'Client or brand is required'
  if (!foundation.deliverable.trim()) errors.deliverable = 'Deliverable is required'
  if (
    foundation.targetDurationSeconds !== null &&
    (!Number.isFinite(foundation.targetDurationSeconds) || foundation.targetDurationSeconds <= 0)
  ) {
    errors.targetDurationSeconds = 'Duration must be greater than zero'
  }
  return errors
}

export function validateBriefSourceInput(extractedText: string): BriefSourceErrors {
  const errors: BriefSourceErrors = {}
  if (!extractedText.trim()) errors.extractedText = 'Brief text is required'
  return errors
}

export function completeBriefSource(
  workflow: ProjectWorkflow,
  input: {
    fileName: string | null
    contentType: BriefSourceContentType | null
    extractedText: string
    sha256: string | null
    cloudAssetId?: string | null
  },
): CompleteBriefSourceResult {
  const errors = validateBriefSourceInput(input.extractedText)
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const extractedText = input.extractedText.trim()
  // Re-submitting the SAME source (the user revisited this step and pressed
  // continue again) must not throw away the interview transcript and the brief
  // derived from it. Only a genuinely different brief invalidates them.
  const sourceUnchanged =
    workflow.briefSource.status === 'ready' && workflow.briefSource.extractedText === extractedText

  return {
    ok: true,
    workflow: {
      ...workflow,
      intake: {
        ...workflow.intake,
        currentStep: 'interview',
      },
      briefSource: {
        status: 'ready',
        fileName: input.fileName,
        contentType: input.contentType,
        extractedText,
        sha256: input.sha256,
        parsedAt: new Date().toISOString(),
        cloudAssetId: input.cloudAssetId ?? null,
      },
      interview: sourceUnchanged
        ? workflow.interview
        : {
            status: 'not-started',
            transcript: [],
          },
      brief: sourceUnchanged
        ? workflow.brief
        : {
            status: 'missing',
            draft: null,
            approvedAt: null,
          },
    },
  }
}

export function beginInterview(workflow: ProjectWorkflow): ProjectWorkflow {
  return {
    ...workflow,
    interview: {
      status: 'in-progress',
      transcript: workflow.interview.transcript,
    },
    brief: {
      ...workflow.brief,
      status: 'generating',
    },
  }
}

export function appendInterviewTurn(
  workflow: ProjectWorkflow,
  turn: Omit<InterviewTurn, 'at'> & { at?: string },
): ProjectWorkflow {
  const entry: InterviewTurn = {
    role: turn.role,
    text: turn.text.trim(),
    at: turn.at ?? new Date().toISOString(),
  }
  return {
    ...workflow,
    interview: {
      status: 'in-progress',
      transcript: [...workflow.interview.transcript, entry],
    },
    brief: {
      ...workflow.brief,
      status: workflow.brief.status === 'approved' ? 'approved' : 'generating',
    },
  }
}

export function completeInterviewBrief(workflow: ProjectWorkflow, draft: string): ProjectWorkflow {
  const trimmed = draft.trim()
  if (!trimmed) return workflow
  return {
    ...workflow,
    intake: {
      ...workflow.intake,
      currentStep: 'summary',
    },
    interview: {
      ...workflow.interview,
      status: 'complete',
    },
    brief: {
      status: 'review-required',
      draft: trimmed,
      approvedAt: null,
    },
  }
}

export function approveCreativeBrief(workflow: ProjectWorkflow): ProjectWorkflow {
  if (!workflow.brief.draft?.trim()) return workflow
  return {
    ...workflow,
    brief: {
      status: 'approved',
      draft: workflow.brief.draft.trim(),
      approvedAt: new Date().toISOString(),
    },
  }
}

export function registerSceneAsset(
  workflow: ProjectWorkflow,
  asset: SceneAssetRecord,
): ProjectWorkflow {
  const assets = workflow.sceneAssets.assets.some((entry) => entry.id === asset.id)
    ? workflow.sceneAssets.assets.map((entry) => (entry.id === asset.id ? asset : entry))
    : [...workflow.sceneAssets.assets, asset]
  return {
    ...workflow,
    sceneAssets: {
      status: 'draft',
      primaryAssetId: workflow.sceneAssets.primaryAssetId ?? asset.id,
      assets,
    },
    subjects: {
      status: 'missing',
      proposal: null,
      approvedAt: null,
    },
  }
}

export function buildSubjectProposal(
  workflow: ProjectWorkflow,
  asset: SceneAssetRecord,
): SubjectProposal {
  const deliverable = workflow.foundation.deliverable.trim() || 'the production'
  const briefHint = workflow.brief.draft?.trim()
  const focusSummary = briefHint
    ? `Treat "${asset.fileName.replace(/\.(glb|gltf)$/i, '')}" as the hero subject for ${deliverable}. Keep framing centered on it and align camera moves with the approved creative brief.`
    : `Treat "${asset.fileName.replace(/\.(glb|gltf)$/i, '')}" as the hero subject for ${deliverable}. Center framing and primary camera moves on this object.`
  return {
    sceneObjectId: asset.sceneObjectId,
    objectName: asset.fileName.replace(/\.(glb|gltf)$/i, ''),
    focusSummary,
  }
}

export function completeAssetIntake(
  workflow: ProjectWorkflow,
  primaryAssetId: string,
): CompleteAssetIntakeResult {
  const errors: AssetIntakeErrors = {}
  if (workflow.sceneAssets.assets.length === 0) {
    errors.assets = 'Import at least one 3D model before continuing.'
  }
  const primary = workflow.sceneAssets.assets.find((asset) => asset.id === primaryAssetId)
  if (!primary) errors.primaryAssetId = 'Select the primary scene asset.'
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const proposal = buildSubjectProposal(workflow, primary!)
  return {
    ok: true,
    workflow: {
      ...workflow,
      sceneAssets: {
        status: 'approved',
        primaryAssetId,
        assets: workflow.sceneAssets.assets,
      },
      subjects: {
        status: 'review-required',
        proposal,
        approvedAt: null,
      },
    },
  }
}

export function updateSubjectProposal(
  workflow: ProjectWorkflow,
  proposal: SubjectProposal,
): ProjectWorkflow {
  return {
    ...workflow,
    subjects: {
      ...workflow.subjects,
      status: workflow.subjects.status === 'approved' ? 'approved' : 'review-required',
      proposal: {
        sceneObjectId: proposal.sceneObjectId,
        objectName: proposal.objectName.trim(),
        focusSummary: proposal.focusSummary.trim(),
      },
    },
  }
}

export function approveSubjects(workflow: ProjectWorkflow): ProjectWorkflow {
  if (!workflow.subjects.proposal?.focusSummary.trim()) return workflow
  return {
    ...workflow,
    subjects: {
      status: 'approved',
      proposal: workflow.subjects.proposal,
      approvedAt: new Date().toISOString(),
    },
  }
}

export function setGuidelinesGenerating(workflow: ProjectWorkflow): ProjectWorkflow {
  return {
    ...workflow,
    guidelines: {
      ...workflow.guidelines,
      status: 'generating',
    },
  }
}

export function setGuidelinesDraft(
  workflow: ProjectWorkflow,
  input: {
    draft: string
    skillName: string
    skillBody: string
    skillId?: string | null
  },
): ProjectWorkflow {
  const draft = input.draft.trim()
  if (!draft) return workflow
  return {
    ...workflow,
    guidelines: {
      status: 'review-required',
      draft,
      skillName: input.skillName.trim() || 'Project direction',
      skillBody: input.skillBody.trim(),
      skillId: input.skillId ?? workflow.guidelines.skillId,
      approvedAt: null,
    },
  }
}

export function approveGuidelines(
  workflow: ProjectWorkflow,
  skillId: string,
): ProjectWorkflow {
  if (!workflow.guidelines.draft?.trim()) return workflow
  return {
    ...workflow,
    guidelines: {
      status: 'approved',
      draft: workflow.guidelines.draft.trim(),
      skillName: workflow.guidelines.skillName?.trim() || 'Project direction',
      skillBody: workflow.guidelines.skillBody?.trim() || workflow.guidelines.draft.trim(),
      skillId,
      approvedAt: new Date().toISOString(),
    },
  }
}

export function setPrdGenerating(workflow: ProjectWorkflow): ProjectWorkflow {
  return {
    ...workflow,
    prd: {
      ...workflow.prd,
      status: 'generating',
    },
  }
}

export function setPrdDraft(workflow: ProjectWorkflow, draft: string): ProjectWorkflow {
  const trimmed = draft.trim()
  if (!trimmed) return workflow
  return {
    ...workflow,
    prd: {
      status: 'review-required',
      draft: trimmed,
      approvedAt: null,
    },
  }
}

export function approvePrd(workflow: ProjectWorkflow): ProjectWorkflow {
  if (!workflow.prd.draft?.trim()) return workflow
  return {
    ...workflow,
    prd: {
      status: 'approved',
      draft: workflow.prd.draft.trim(),
      approvedAt: new Date().toISOString(),
    },
  }
}

export function setShotListGenerating(workflow: ProjectWorkflow): ProjectWorkflow {
  return {
    ...workflow,
    shotList: {
      ...workflow.shotList,
      status: 'generating',
    },
  }
}

export function setShotListDraft(
  workflow: ProjectWorkflow,
  input: { shots: PlannedShot[]; summary?: string | null },
): ProjectWorkflow {
  const shots = input.shots
    .map((shot, index) => ({
      ...shot,
      order: index,
      name: shot.name.trim(),
      intent: shot.intent.trim(),
      framingNotes: shot.framingNotes.trim(),
      constraints: shot.constraints.map((item) => item.trim()).filter(Boolean),
      durationSeconds:
        Number.isFinite(shot.durationSeconds) && shot.durationSeconds > 0
          ? shot.durationSeconds
          : 4,
    }))
    .filter((shot) => shot.name && shot.intent)

  return {
    ...workflow,
    shotList: {
      status: 'review-required',
      revision: workflow.shotList.revision + 1,
      artifactId: workflow.shotList.artifactId,
      shots,
      summary: input.summary?.trim() || null,
      approvedAt: null,
    },
  }
}

export function updatePlannedShot(
  workflow: ProjectWorkflow,
  shotId: string,
  patch: Partial<Omit<PlannedShot, 'id' | 'order'>>,
): ProjectWorkflow {
  // Keep the raw text while editing: trimming/filtering here fights controlled
  // inputs (a trailing space or a comma would be swallowed on every keystroke).
  // Normalisation happens once, on approval (see approveShotList).
  const shots = workflow.shotList.shots.map((shot) =>
    shot.id === shotId ? { ...shot, ...patch } : shot,
  )
  return {
    ...workflow,
    shotList: {
      ...workflow.shotList,
      status: workflow.shotList.status === 'approved' ? 'approved' : 'review-required',
      shots,
      approvedAt: null,
    },
  }
}

/**
 * Append an empty shot so the list can be authored (or recovered) by hand —
 * without this, deleting every shot left regeneration as the only way back.
 */
export function addPlannedShot(workflow: ProjectWorkflow): ProjectWorkflow {
  const shots = [
    ...workflow.shotList.shots,
    {
      id: crypto.randomUUID(),
      order: workflow.shotList.shots.length,
      name: '',
      profile: 'packshot' as CameraProfile,
      durationSeconds: 3,
      intent: '',
      framingNotes: '',
      constraints: [],
    },
  ].map((shot, index) => ({ ...shot, order: index }))
  return {
    ...workflow,
    shotList: {
      ...workflow.shotList,
      status: 'review-required',
      shots,
      approvedAt: null,
    },
  }
}

export function removePlannedShot(workflow: ProjectWorkflow, shotId: string): ProjectWorkflow {
  const shots = workflow.shotList.shots
    .filter((shot) => shot.id !== shotId)
    .map((shot, index) => ({ ...shot, order: index }))
  return {
    ...workflow,
    shotList: {
      ...workflow.shotList,
      status: 'review-required',
      shots,
      approvedAt: null,
    },
  }
}

export function approveShotList(workflow: ProjectWorkflow): ApproveShotListResult {
  if (workflow.shotList.shots.length === 0) {
    return { ok: false, errors: { shots: 'Add at least one planned shot before approval.' } }
  }
  const invalid = workflow.shotList.shots.some(
    (shot) => !shot.name.trim() || !shot.intent.trim() || shot.durationSeconds <= 0,
  )
  if (invalid) {
    return {
      ok: false,
      errors: { shots: 'Every shot needs a name, intent, and positive duration.' },
    }
  }

  const artifactId = workflow.shotList.artifactId ?? crypto.randomUUID()

  return {
    ok: true,
    workflow: {
      ...workflow,
      intake: {
        ...workflow.intake,
        status: 'approved',
        currentStep: 'summary',
      },
      shotList: {
        ...workflow.shotList,
        status: 'approved',
        artifactId,
        // normalise the free-text fields once, at approval time
        shots: workflow.shotList.shots.map((shot, index) => ({
          ...shot,
          order: index,
          name: shot.name.trim(),
          intent: shot.intent.trim(),
          framingNotes: shot.framingNotes.trim(),
          constraints: shot.constraints.map((item) => item.trim()).filter(Boolean),
        })),
        approvedAt: new Date().toISOString(),
      },
    },
  }
}

export function completeProjectFoundation(workflow: ProjectWorkflow): CompleteFoundationResult {
  const errors = validateProjectFoundation(workflow.foundation)
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    workflow: {
      ...workflow,
      intake: {
        ...workflow.intake,
        currentStep: 'brief-source',
      },
      foundation: {
        ...workflow.foundation,
        status: 'complete',
        client: workflow.foundation.client.trim(),
        deliverable: workflow.foundation.deliverable.trim(),
        targetChannels: workflow.foundation.targetChannels.map((channel) => channel.trim()).filter(Boolean),
      },
    },
  }
}

export function nextRequiredProjectAction(workflow: ProjectWorkflow): RequiredProjectAction {
  if (workflow.legacyEditorAccess || workflow.intake.status === 'approved') return 'editor'
  if (workflow.foundation.status !== 'complete') return 'foundation'
  if (workflow.briefSource.status !== 'ready') return 'brief-source'
  if (workflow.brief.status === 'review-required') return 'brief-review'
  if (
    workflow.brief.status === 'missing' ||
    workflow.brief.status === 'draft' ||
    workflow.brief.status === 'generating' ||
    workflow.brief.status === 'stale' ||
    workflow.brief.status === 'failed'
  ) {
    return 'interview'
  }
  if (
    workflow.subjects.status === 'missing' ||
    workflow.subjects.status === 'stale' ||
    workflow.subjects.status === 'failed'
  ) {
    return 'asset-intake'
  }
  if (workflow.subjects.status !== 'approved') return 'subject-confirmation'
  if (workflow.guidelines.status !== 'approved') return 'guidelines-review'
  if (workflow.prd.status !== 'approved') return 'prd-review'
  if (workflow.shotList.status !== 'approved') return 'shot-list-review'
  // Shot list approved without intake approval should not skip the hard gate.
  return 'shot-list-review'
}

export function isProjectEditorReady(workflow: ProjectWorkflow) {
  return nextRequiredProjectAction(workflow) === 'editor'
}