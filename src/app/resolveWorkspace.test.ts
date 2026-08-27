import { describe, expect, it } from 'vitest'
import { createProjectWorkflow, nextRequiredProjectAction } from '../lib/projectWorkflow'
import { resolveWorkspace } from './resolveWorkspace'

describe('resolveWorkspace', () => {
  it('opens the editor even when intake is still a draft', () => {
    const draft = createProjectWorkflow('Untitled')
    expect(nextRequiredProjectAction(draft)).toBe('foundation')
    expect(resolveWorkspace('editor')).toBe('editor')
    expect(resolveWorkspace('board')).toBe('editor')
  })

  it('never returns anything but projects or editor', () => {
    expect(resolveWorkspace('projects')).toBe('projects')
  })
})
