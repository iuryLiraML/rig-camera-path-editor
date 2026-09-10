import { describe, expect, it } from 'vitest'
import { createProjectWorkflow, migrateProjectWorkflow } from './projectWorkflow'
import { approveProductionItems, reconcileProductionList } from './productionWorkflow'

/**
 * A generation writes `status: 'generating'` to the store *before* the request,
 * and the 800 ms autosave persists it. Reloading mid-generation must not leave
 * the artifact stuck in a state no in-page action can clear.
 */
describe('migrateProjectWorkflow — transient generating status', () => {
  const artifacts = ['guidelines', 'prd', 'shotList'] as const

  for (const artifact of artifacts) {
    it(`recovers ${artifact} from a persisted 'generating' status`, () => {
      const stored = {
        ...createProjectWorkflow('Test'),
        [artifact]: { ...createProjectWorkflow('Test')[artifact], status: 'generating' as const },
      }

      const migrated = migrateProjectWorkflow(
        JSON.parse(JSON.stringify(stored)) as unknown,
        'Test',
      )

      expect(migrated[artifact].status).not.toBe('generating')
    })
  }

  it('leaves settled statuses untouched', () => {
    const base = createProjectWorkflow('Test')
    const stored = {
      ...base,
      guidelines: { ...base.guidelines, status: 'approved' as const, draft: 'keep me' },
    }

    const migrated = migrateProjectWorkflow(JSON.parse(JSON.stringify(stored)) as unknown, 'Test')

    expect(migrated.guidelines.status).toBe('approved')
    expect(migrated.guidelines.draft).toBe('keep me')
  })

  it('adds an empty production list to version 1 projects without losing their approved artifacts', () => {
    const previous = createProjectWorkflow('Test') as unknown as Record<string, unknown>
    previous.schemaVersion = 1
    delete previous.production
    const migrated = migrateProjectWorkflow(previous, 'Test')

    expect(migrated.production).toEqual({
      sourceRevisionId: null,
      scenes: [],
      items: [],
      lastDiff: { addedItemIds: [], changedItemIds: [], removedItemIds: [] },
    })
    expect(migrated.foundation).toEqual(previous.foundation)
  })

  it('round-trips approved production identities and fulfillment links', () => {
    const workflow = createProjectWorkflow('Test')
    const proposed = reconcileProductionList(workflow.production, {
      revisionId: 'script-v1',
      scenes: [{ sourceKey: 'studio', name: 'Studio' }],
      items: [{
        sourceKey: 'hero', sourceFingerprint: 'hero-v1', name: 'Hero', kind: 'character',
        provenance: 'explicit', quantity: 1, sceneSourceKeys: ['studio'], prompt: 'Hero',
      }],
    }).list
    workflow.production = approveProductionItems(proposed, [proposed.items[0].id], 'guidelines-v1')
    workflow.production.items[0].fulfilledByAssetId = 'asset-hero'
    workflow.production.items[0].fulfillmentMethod = 'existing'

    const migrated = migrateProjectWorkflow(JSON.parse(JSON.stringify(workflow)), 'Test')
    expect(migrated.production.items[0]).toMatchObject({
      sourceKey: 'hero',
      requirementStatus: 'approved',
      fulfilledByAssetId: 'asset-hero',
      fulfillmentMethod: 'existing',
    })
  })
})
