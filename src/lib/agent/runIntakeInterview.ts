import {
  runAgent,
  PROVIDERS,
  type AgentMessage,
  type ProviderConfig,
  type ProviderKind,
} from './providers'
import {
  buildIntakeInterviewPrompt,
  extractCreativeBrief,
  interviewMessagesFromTranscript,
} from './intakeInterview'
import type { ProjectWorkflow } from '../projectWorkflow'

export interface IntakeInterviewConfig {
  provider: ProviderKind
  apiKey: string
  model: string
}

export interface IntakeInterviewResult {
  assistantText: string
  creativeBrief: string | null
  messages: AgentMessage[]
}

export async function runIntakeInterviewTurn(
  workflow: ProjectWorkflow,
  config: IntakeInterviewConfig,
  signal?: AbortSignal,
): Promise<IntakeInterviewResult> {
  const provider: ProviderConfig = {
    kind: config.provider,
    apiKey: config.apiKey,
    model: config.model.trim() || PROVIDERS[config.provider].defaultModel,
    vision: false,
  }
  const history: AgentMessage[] = interviewMessagesFromTranscript(workflow).map(
    (message): AgentMessage =>
      message.role === 'user'
        ? { role: 'user', text: message.text }
        : { role: 'assistant', text: message.text, toolCalls: [] },
  )

  const result = await runAgent({
    provider,
    system: buildIntakeInterviewPrompt(workflow),
    messages: history,
    tools: [],
    execute: () => '',
    signal,
    maxTurns: 1,
  })

  const last = result.messages[result.messages.length - 1]
  const assistantText = last?.role === 'assistant' ? last.text : ''
  return {
    assistantText,
    creativeBrief: extractCreativeBrief(assistantText),
    messages: result.messages,
  }
}
