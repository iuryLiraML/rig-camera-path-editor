import {
  runAgent,
  PROVIDERS,
  type ProviderConfig,
  type ProviderKind,
} from './providers'
import {
  buildGuidelinesGenerationPrompt,
  buildPrdGenerationPrompt,
  buildShotListGenerationPrompt,
  parseGuidelinesGeneration,
  parsePrdGeneration,
  parseShotListGeneration,
} from './directionArtifacts'
import {
  CAMERA_PROFILES,
  type CameraProfile,
  type PlannedShot,
  type ProjectWorkflow,
} from '../projectWorkflow'

export interface DirectionGenerationConfig {
  provider: ProviderKind
  apiKey: string
  model: string
}

function toProvider(config: DirectionGenerationConfig): ProviderConfig {
  return {
    kind: config.provider,
    apiKey: config.apiKey,
    model: config.model.trim() || PROVIDERS[config.provider].defaultModel,
    vision: false,
  }
}

export async function generateGuidelinesArtifact(
  workflow: ProjectWorkflow,
  config: DirectionGenerationConfig,
  signal?: AbortSignal,
) {
  const result = await runAgent({
    provider: toProvider(config),
    system: buildGuidelinesGenerationPrompt(workflow),
    messages: [
      {
        role: 'user',
        text: 'Generate the direction guidelines and project skill now.',
      },
    ],
    tools: [],
    execute: () => '',
    signal,
    maxTurns: 1,
  })
  const last = result.messages[result.messages.length - 1]
  const assistantText = last?.role === 'assistant' ? last.text : ''
  const parsed = parseGuidelinesGeneration(assistantText)
  if (!parsed) {
    throw new Error('The model did not return tagged guidelines. Try regenerating.')
  }
  return { ...parsed, raw: assistantText }
}

export async function generatePrdArtifact(
  workflow: ProjectWorkflow,
  config: DirectionGenerationConfig,
  signal?: AbortSignal,
) {
  const result = await runAgent({
    provider: toProvider(config),
    system: buildPrdGenerationPrompt(workflow),
    messages: [
      {
        role: 'user',
        text: 'Generate the production PRD now.',
      },
    ],
    tools: [],
    execute: () => '',
    signal,
    maxTurns: 1,
  })
  const last = result.messages[result.messages.length - 1]
  const assistantText = last?.role === 'assistant' ? last.text : ''
  const draft = parsePrdGeneration(assistantText)
  if (!draft) {
    throw new Error('The model did not return a tagged PRD. Try regenerating.')
  }
  return { draft, raw: assistantText }
}

function toCameraProfile(value: string): CameraProfile {
  return (CAMERA_PROFILES as readonly string[]).includes(value)
    ? (value as CameraProfile)
    : 'custom'
}

export async function generateShotListArtifact(
  workflow: ProjectWorkflow,
  config: DirectionGenerationConfig,
  signal?: AbortSignal,
): Promise<{ shots: PlannedShot[]; summary: string | null; raw: string }> {
  const result = await runAgent({
    provider: toProvider(config),
    system: buildShotListGenerationPrompt(workflow),
    messages: [
      {
        role: 'user',
        text: 'Generate the formal shot list JSON now.',
      },
    ],
    tools: [],
    execute: () => '',
    signal,
    maxTurns: 1,
  })
  const last = result.messages[result.messages.length - 1]
  const assistantText = last?.role === 'assistant' ? last.text : ''
  const parsed = parseShotListGeneration(assistantText)
  if (!parsed) {
    throw new Error('The model did not return a valid shot list. Try regenerating.')
  }
  return {
    summary: parsed.summary,
    shots: parsed.shots.map((shot, index) => ({
      id: shot.id,
      order: index,
      name: shot.name,
      profile: toCameraProfile(shot.profile),
      durationSeconds: shot.durationSeconds,
      intent: shot.intent,
      framingNotes: shot.framingNotes,
      constraints: shot.constraints,
    })),
    raw: assistantText,
  }
}
