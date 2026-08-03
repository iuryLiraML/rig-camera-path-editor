import { describe, expect, it } from 'vitest'
import {
  parseGuidelinesGeneration,
  parsePrdGeneration,
  buildGuidelinesGenerationPrompt,
} from './directionArtifacts'
import {
  approveCreativeBrief,
  approveSubjects,
  completeAssetIntake,
  completeBriefSource,
  completeInterviewBrief,
  completeProjectFoundation,
  createProjectWorkflow,
  registerSceneAsset,
  updateProjectFoundation,
} from '../projectWorkflow'

function readyWorkflow() {
  const foundation = completeProjectFoundation(
    updateProjectFoundation(createProjectWorkflow('Launch'), {
      client: 'Acme',
      deliverable: 'Product film',
      targetChannels: ['Reels'],
      targetDurationSeconds: 15,
    }),
  )
  if (!foundation.ok) throw new Error('foundation')
  const briefReady = completeBriefSource(foundation.workflow, {
    fileName: 'brief.txt',
    contentType: 'text/plain',
    extractedText: 'Orbit the bottle.',
    sha256: 'a'.repeat(64),
  })
  if (!briefReady.ok) throw new Error('brief source')
  const briefApproved = approveCreativeBrief(
    completeInterviewBrief(briefReady.workflow, '## Objective\nOrbit the bottle.'),
  )
  const withAsset = registerSceneAsset(briefApproved, {
    id: 'asset-1',
    sceneObjectId: 'obj-1',
    fileName: 'bottle.glb',
    contentType: 'model/gltf-binary',
    byteSize: 100,
    sha256: 'b'.repeat(64),
    cloudAssetId: null,
    importedAt: '2026-07-15T00:00:00.000Z',
  })
  const intake = completeAssetIntake(withAsset, 'asset-1')
  if (!intake.ok) throw new Error('assets')
  return approveSubjects(intake.workflow)
}

describe('direction artifact parsing', () => {
  it('builds a prompt with foundation, brief, and subject context', () => {
    const prompt = buildGuidelinesGenerationPrompt(readyWorkflow())
    expect(prompt).toContain('Acme')
    expect(prompt).toContain('Orbit the bottle')
    expect(prompt).toContain('bottle')
    expect(prompt).toContain('<guidelines>')
  })

  it('extracts guidelines and project skill tags', () => {
    const parsed = parseGuidelinesGeneration(`
<guidelines>
## Tone
Premium and calm.
</guidelines>
<project_skill_name>
Bottle Orbit Direction
</project_skill_name>
<project_skill>
1. Frame the bottle at center.
2. Prefer slow orbits.
</project_skill>
`)
    expect(parsed).toEqual({
      draft: '## Tone\nPremium and calm.',
      skillName: 'Bottle Orbit Direction',
      skillBody: '1. Frame the bottle at center.\n2. Prefer slow orbits.',
    })
  })

  it('extracts the prd tag', () => {
    expect(parsePrdGeneration('<prd>\n## Objective\nSell the bottle.\n</prd>')).toContain(
      'Sell the bottle',
    )
  })
})
