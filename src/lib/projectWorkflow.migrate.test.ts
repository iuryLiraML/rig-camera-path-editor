import { describe, expect, it } from 'vitest'
import { createProjectWorkflow, migrateProjectWorkflow } from './projectWorkflow'

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
})
