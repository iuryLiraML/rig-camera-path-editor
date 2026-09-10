import { describe, expect, it, vi } from 'vitest'
import { generateProductionBreakdown, parseProductionBreakdown } from './productionBreakdown'
import { runAgent } from './providers'
import { createProductionList, reconcileProductionList } from '../productionWorkflow'

vi.mock('./providers', async (load) => ({
  ...await load<typeof import('./providers')>(),
  runAgent: vi.fn(),
}))

function draft() {
  return {
    name: 'Cafe encounter', guidelines: 'Quiet contemporary cafe.',
    scenes: [{ sourceKey: 'cafe', name: 'Cafe' }, { sourceKey: 'street', name: 'Street' }],
    items: [{ sourceKey: 'ana', name: 'Ana', kind: 'character', provenance: 'explicit', quantity: 1,
      sceneSourceKeys: ['cafe', 'street'], prompt: 'Full-body Ana in a raincoat', identityKey: 'ana', variantLabel: null, backgroundMode: null },
    { sourceKey: 'chairs', name: 'Chair', kind: 'prop', provenance: 'explicit', quantity: 10,
      sceneSourceKeys: ['cafe'], prompt: 'One bentwood chair', identityKey: 'chair', variantLabel: null, backgroundMode: null }],
  }
}

describe('model-authored production breakdown', () => {
  it('turns a model proposal into unapproved requirements with shared scenes and reusable quantity', async () => {
    vi.mocked(runAgent).mockImplementationOnce(async (options) => {
      await options.execute('propose_production_plan', draft())
      return { messages: [], outcome: 'exhausted', turns: 1 }
    })
    const result = await generateProductionBreakdown({ source: 'Ana enters a cafe with ten identical chairs, then leaves for the street.' })
    const { list } = reconcileProductionList(createProductionList(), result.proposal)
    expect(list.items).toHaveLength(2)
    expect(list.items[0].sceneIds).toHaveLength(2)
    expect(list.items[1].quantity).toBe(10)
    expect(list.items.every((item) => item.requirementStatus === 'needs-review' && !item.generationRequests.length)).toBe(true)
  })

  it('rejects broken assignments and duplicate stable identities', () => {
    const input = draft()
    input.items[0].sceneSourceKeys = ['missing']
    expect(() => parseProductionBreakdown(input)).toThrow('missing')
    const duplicate = draft()
    duplicate.items.push(duplicate.items[0])
    expect(() => parseProductionBreakdown(duplicate)).toThrow('duplicate')
  })

  it('rejects partial responses and ignores model-injected approval fields', () => {
    expect(() => parseProductionBreakdown({ name: 'Incomplete' })).toThrow('incomplete')
    const input = draft()
    const result = parseProductionBreakdown({ ...input, items: input.items.map((item) => ({ ...item, requirementStatus: 'approved' })) })
    expect(result.proposal.items[0]).not.toHaveProperty('requirementStatus')
  })

  it('uses content revisions rather than trusting a model fingerprint', () => {
    const input = draft()
    const first = parseProductionBreakdown(input)
    input.items[0].prompt = 'Full-body Ana in a business suit'
    const second = parseProductionBreakdown(input)
    expect(first.proposal.items[0].sourceFingerprint).not.toBe(second.proposal.items[0].sourceFingerprint)
  })
})
