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

  it('keeps Projects and the editor as their own workspaces', () => {
    expect(resolveWorkspace('projects')).toBe('projects')
    expect(resolveWorkspace('editor')).toBe('editor')
  })

  it('mounts Home and Library as their own workspaces', () => {
    expect(resolveWorkspace('home')).toBe('home')
    expect(resolveWorkspace('library')).toBe('library')
    expect(resolveWorkspace('projects')).toBe('projects')
  })
})
