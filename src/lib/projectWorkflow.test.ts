import { describe, expect, it } from 'vitest'
import {
  completeProjectFoundation,
  createLegacyProjectWorkflow,
  createProjectWorkflow,
  nextRequiredProjectAction,
  updateProjectFoundation,
} from './projectWorkflow'

describe('project workflow', () => {
  it('keeps a new project in intake until its required foundation is complete', () => {
    const draft = createProjectWorkflow('Launch film')

    expect(nextRequiredProjectAction(draft)).toBe('foundation')
    expect(completeProjectFoundation(draft)).toEqual({
      ok: false,
      errors: {
        client: 'Client or brand is required',
        deliverable: 'Deliverable is required',
      },
    })

    const ready = updateProjectFoundation(draft, {
      client: 'Acme',
      deliverable: '30-second product film',
    })
    const completed = completeProjectFoundation(ready)

    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(nextRequiredProjectAction(completed.workflow)).toBe('brief-source')
  })

  it('grandfathers projects created before the workflow without blocking the editor', () => {
    const workflow = createLegacyProjectWorkflow('Existing project')

    expect(nextRequiredProjectAction(workflow)).toBe('editor')
  })
})