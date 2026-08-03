import type { ProjectWorkflow } from '../projectWorkflow'

function briefExcerpt(text: string | null | undefined, max = 3_000) {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return '(none)'
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max)}…`
}

function subjectBlock(workflow: ProjectWorkflow) {
  const proposal = workflow.subjects.proposal
  if (!proposal) return '(subject not confirmed)'
  return [
    `Subject name: ${proposal.objectName}`,
    `Scene object id: ${proposal.sceneObjectId}`,
    `Focus: ${proposal.focusSummary}`,
  ].join('\n')
}

function foundationBlock(workflow: ProjectWorkflow) {
  const f = workflow.foundation
  const channels = f.targetChannels.length ? f.targetChannels.join(', ') : 'not specified'
  const duration =
    f.targetDurationSeconds !== null ? `${f.targetDurationSeconds}s` : 'not specified'
  return [
    `Client/brand: ${f.client}`,
    `Deliverable: ${f.deliverable}`,
    `Target channels: ${channels}`,
    `Target duration: ${duration}`,
  ].join('\n')
}

export function buildGuidelinesGenerationPrompt(workflow: ProjectWorkflow) {
  return `You are the director of photography preparing production guidelines for Rig, a web
3D camera-direction tool. Write durable camera rules the later assistant must obey.

## Inputs
### Foundation
${foundationBlock(workflow)}

### Approved creative brief
${briefExcerpt(workflow.brief.draft)}

### Confirmed subject
${subjectBlock(workflow)}

## Output format (exact tags, no commentary outside them)
<guidelines>
Markdown guidelines covering:
- Visual tone and emotional register
- Preferred camera language (profiles: packshot, reveal/orbit, dolly, FPV/drone as relevant)
- Prohibited moves and framing
- Subject framing / focus rules tied to the confirmed subject
- Pacing and duration instincts
- Channel / aspect constraints
</guidelines>
<project_skill_name>
Short skill name (3-6 words)
</project_skill_name>
<project_skill>
A reusable skill recipe the editor agent can load. Include concrete world-unit guidance
(floor y=0, subjects ~2 units tall) and step-by-step camera construction notes aligned to
the guidelines. Plain text or markdown, no angle brackets nested inside this tag.
</project_skill>`
}

export function buildPrdGenerationPrompt(workflow: ProjectWorkflow) {
  return `You are the producer/DP writing a concise production PRD for a camera-direction
project inside Rig (web 3D tool). The PRD prepares the shot list generation stage.

## Inputs
### Foundation
${foundationBlock(workflow)}

### Approved creative brief
${briefExcerpt(workflow.brief.draft)}

### Confirmed subject
${subjectBlock(workflow)}

### Approved direction guidelines
${briefExcerpt(workflow.guidelines.draft)}

## Output format (exact tags, no commentary outside them)
<prd>
Markdown PRD with sections:
1. Objective
2. Audience & channels
3. Hero subject & focus
4. Camera language plan (which move profiles to use and why)
5. Constraints & prohibitions
6. Suggested shot sequence outline (named shots, durations if known — not a formal shot list yet)
7. Success criteria for later validation
</prd>`
}

export function extractTaggedBlock(text: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i')
  const match = pattern.exec(text)
  return match?.[1]?.trim() || null
}

export function parseGuidelinesGeneration(text: string): {
  draft: string
  skillName: string
  skillBody: string
} | null {
  const draft = extractTaggedBlock(text, 'guidelines')
  if (!draft) return null
  const skillName = extractTaggedBlock(text, 'project_skill_name') ?? 'Project direction'
  const skillBody = extractTaggedBlock(text, 'project_skill') ?? draft
  return { draft, skillName, skillBody }
}

export function parsePrdGeneration(text: string): string | null {
  return extractTaggedBlock(text, 'prd')
}

export function buildShotListGenerationPrompt(workflow: ProjectWorkflow) {
  const durationHint =
    workflow.foundation.targetDurationSeconds !== null
      ? `Aim for about ${workflow.foundation.targetDurationSeconds}s total across all shots.`
      : 'Choose sensible short web-ad durations (typically 2–6s per shot).'

  return `You are the director of photography authoring a formal shot list for Rig, a web 3D
camera-direction tool. Each shot will later be generated as a camera option/candidate.

## Inputs
### Foundation
${foundationBlock(workflow)}

### Approved creative brief
${briefExcerpt(workflow.brief.draft)}

### Confirmed subject
${subjectBlock(workflow)}

### Approved direction guidelines
${briefExcerpt(workflow.guidelines.draft)}

### Approved production PRD
${briefExcerpt(workflow.prd.draft)}

## Profiles (use only these values)
- packshot
- reveal-orbit
- dolly
- fpv-drone
- custom

## Rules
- Propose 3–8 shots unless the brief clearly needs fewer.
- ${durationHint}
- Every shot must serve the confirmed subject and respect prohibited moves.
- Prefer concrete intents (what the camera does), not marketing fluff.

## Output format (exact tags, no commentary outside them)
<summary>
One short paragraph summarizing the sequence.
</summary>
<shot_list_json>
[
  {
    "id": "shot-01",
    "name": "Hero Orbit",
    "profile": "reveal-orbit",
    "durationSeconds": 4,
    "intent": "Slow orbit revealing the label.",
    "framingNotes": "Keep subject centered, medium close.",
    "constraints": ["no whip pan", "level horizon"]
  }
]
</shot_list_json>
Return valid JSON only inside the shot_list_json tag.`
}

export function parseShotListGeneration(text: string): {
  summary: string | null
  shots: Array<{
    id: string
    name: string
    profile: string
    durationSeconds: number
    intent: string
    framingNotes: string
    constraints: string[]
  }>
} | null {
  const summary = extractTaggedBlock(text, 'summary')
  const jsonBlock = extractTaggedBlock(text, 'shot_list_json')
  if (!jsonBlock) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonBlock)
  } catch {
    // Allow fenced leftovers if the model wraps JSON awkwardly.
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(jsonBlock)
    if (!fenced) return null
    try {
      parsed = JSON.parse(fenced[1])
    } catch {
      return null
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return null

  const shots = parsed
    .map((item, index) => {
      if (typeof item !== 'object' || item === null) return null
      const row = item as Record<string, unknown>
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      const intent = typeof row.intent === 'string' ? row.intent.trim() : ''
      if (!name || !intent) return null
      const duration =
        typeof row.durationSeconds === 'number' &&
        Number.isFinite(row.durationSeconds) &&
        row.durationSeconds > 0
          ? row.durationSeconds
          : 4
      return {
        id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `shot-${index + 1}`,
        name,
        profile: typeof row.profile === 'string' ? row.profile : 'custom',
        durationSeconds: duration,
        intent,
        framingNotes: typeof row.framingNotes === 'string' ? row.framingNotes : '',
        constraints: Array.isArray(row.constraints)
          ? row.constraints.filter((value): value is string => typeof value === 'string')
          : [],
      }
    })
    .filter((shot): shot is NonNullable<typeof shot> => shot !== null)

  if (shots.length === 0) return null
  return { summary, shots }
}
