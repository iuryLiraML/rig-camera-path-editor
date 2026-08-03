import { describe, expect, it } from 'vitest'
import { extractCreativeBrief, INTERVIEW_TOPICS } from './intakeInterview'
import { createProjectWorkflow, updateProjectFoundation } from '../projectWorkflow'
import { buildIntakeInterviewPrompt } from './intakeInterview'

describe('intake interview prompt', () => {
  it('includes foundation facts and the client brief excerpt', () => {
    const workflow = updateProjectFoundation(
      createProjectWorkflow('Launch'),
      {
        client: 'Acme',
        deliverable: '30-second product film',
        targetChannels: ['Instagram Reels'],
        targetDurationSeconds: 30,
      },
    )
    workflow.briefSource = {
      status: 'ready',
      fileName: 'brief.txt',
      contentType: 'text/plain',
      extractedText: 'Premium orbit around the hero bottle.',
      sha256: null,
      parsedAt: '2026-07-14T00:00:00.000Z',
      cloudAssetId: null,
    }

    const prompt = buildIntakeInterviewPrompt(workflow)

    expect(prompt).toContain('Acme')
    expect(prompt).toContain('Premium orbit around the hero bottle.')
    expect(prompt).toContain(INTERVIEW_TOPICS[0])
    expect(prompt).toContain('ONE question per response')
  })

  it('extracts a creative brief from tagged synthesis output', () => {
    const text = `Thanks — synthesizing now.
<creative_brief>
## Objective
Launch the hero product with a premium orbit.
</creative_brief>`

    expect(extractCreativeBrief(text)).toContain('premium orbit')
  })
})
