import type { ProjectFoundation, ProjectWorkflow } from '../projectWorkflow'

export const INTERVIEW_TOPICS = [
  'visual style and emotional tone',
  'camera movement language (orbits, dollies, reveals, FPV, etc.)',
  'moves or framing that are prohibited',
  'subject emphasis and hero moments',
  'pacing, rhythm, and duration feel',
  'references or brands to emulate or avoid',
  'channel-specific constraints beyond the foundation',
] as const

function formatFoundation(foundation: ProjectFoundation) {
  const channels = foundation.targetChannels.length
    ? foundation.targetChannels.join(', ')
    : 'not specified'
  const duration =
    foundation.targetDurationSeconds !== null
      ? `${foundation.targetDurationSeconds}s`
      : 'to be determined in interview'
  return [
    `Client/brand: ${foundation.client}`,
    `Deliverable: ${foundation.deliverable}`,
    `Target channels: ${channels}`,
    `Target duration: ${duration}`,
  ].join('\n')
}

function briefExcerpt(text: string, max = 2_400) {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

export function buildIntakeInterviewPrompt(workflow: ProjectWorkflow) {
  const topics = INTERVIEW_TOPICS.map((topic, index) => `${index + 1}. ${topic}`).join('\n')
  return `You are the director of photography conducting a mandatory pre-production interview
inside Rig, a web 3D camera-direction tool. This is NOT the live editor assistant — you
cannot use tools, change the scene, or build camera moves yet.

## Your job
- Grill the client about the production until you understand style, constraints, and intent.
- Ask exactly ONE question per response. Never ask multiple questions in one turn.
- For each question, include a short recommended default answer the client can accept or edit.
- Keep questions concrete and production-oriented, not generic brainstorming.
- Use the client brief and foundation facts below. Do not re-ask what is already answered unless
  you need clarification.

## Topics to cover (in a sensible order, one per turn)
${topics}

## Foundation
${formatFoundation(workflow.foundation)}

## Client brief source
${briefExcerpt(workflow.briefSource.extractedText)}

## Rules
- Stay in interview mode until the client asks you to synthesize the brief.
- When the client says to synthesize/finish, output the creative brief ONLY between tags:
  <creative_brief>
  ...markdown brief...
  </creative_brief>
- The creative brief must consolidate: objective, audience, tone, camera language, prohibited
  moves, pacing, references, and delivery constraints.
- Outside synthesis mode, do not output <creative_brief> tags.
- Keep each response under 120 words unless synthesizing the brief.`
}

export function extractCreativeBrief(text: string): string | null {
  const match = /<creative_brief>([\s\S]*?)<\/creative_brief>/i.exec(text)
  return match?.[1]?.trim() || null
}

export function interviewMessagesFromTranscript(
  workflow: ProjectWorkflow,
): { role: 'user' | 'assistant'; text: string }[] {
  return workflow.interview.transcript.map((turn) => ({
    role: turn.role === 'director' ? 'assistant' : 'user',
    text: turn.text,
  }))
}
