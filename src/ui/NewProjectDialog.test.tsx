// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewProjectDialog } from './NewProjectDialog'
import { useProjectCreationStore } from '../state/useProjectCreationStore'
import { useEditorStore } from '../state/useEditorStore'
import { generateProductionBreakdown } from '../lib/agent/productionBreakdown'
import { createGuidedProject, createProject } from '../lib/projects'

vi.mock('../lib/agent/productionBreakdown', () => ({ generateProductionBreakdown: vi.fn() }))
vi.mock('../lib/projects', () => ({ createGuidedProject: vi.fn(async () => 'guided'), createProject: vi.fn(async () => 'blank') }))

beforeEach(() => {
  vi.clearAllMocks()
  useProjectCreationStore.getState().show('folder-1')
  useEditorStore.setState({ showProduction: false, appView: 'home' })
})
afterEach(() => { cleanup(); useProjectCreationStore.getState().close() })

describe('project creation choices', () => {
  it('does not create records when opened or cancelled; Blank explicitly opens Build', async () => {
    const screen = render(<NewProjectDialog />)
    expect(createProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close new project' }))
    expect(createProject).not.toHaveBeenCalled()
    useProjectCreationStore.getState().show('folder-1')
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Blank scene/ }))
    await waitFor(() => expect(createProject).toHaveBeenCalledExactlyOnceWith('New project', 'folder-1'))
    expect(useEditorStore.getState()).toMatchObject({ appView: 'editor', workspaceMode: 'build', showProduction: false })
  })

  it('runs AI analysis, allows scene/name edits and creates only on confirmation', async () => {
    vi.mocked(generateProductionBreakdown).mockResolvedValueOnce({
      name: 'Cafe', guidelines: 'Contemporary', proposal: { revisionId: 'v1', scenes: [{ sourceKey: 'cafe', name: 'Cafe interior' }], items: [] },
    })
    const screen = render(<NewProjectDialog />)
    fireEvent.click(screen.getByRole('button', { name: /Start with AI/ }))
    fireEvent.change(screen.getByLabelText('Script or project description'), { target: { value: 'A cafe at dawn.' } })
    fireEvent.change(screen.getByLabelText('Number of scenes'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create production plan' }))
    await screen.findByLabelText('Project name')
    expect(createGuidedProject).not.toHaveBeenCalled()
    expect(generateProductionBreakdown).toHaveBeenCalledWith(expect.objectContaining({ sceneCount: 1 }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Morning film' } })
    fireEvent.change(screen.getByLabelText('Scene 1'), { target: { value: 'Opening scene' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project and review assets' }))
    await waitFor(() => expect(createGuidedProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Morning film', proposal: expect.objectContaining({ scenes: [{ sourceKey: 'cafe', name: 'Opening scene' }] }) }), 'A cafe at dawn.', 'folder-1'))
    expect(useEditorStore.getState().showProduction).toBe(true)
  })

  it('keeps the brief available when the model fails without creating a project', async () => {
    vi.mocked(generateProductionBreakdown).mockRejectedValueOnce(new Error('Model unavailable'))
    const screen = render(<NewProjectDialog />)
    fireEvent.click(screen.getByRole('button', { name: /Start with AI/ }))
    fireEvent.change(screen.getByLabelText('Script or project description'), { target: { value: 'My film' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create production plan' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Model unavailable')
    expect(screen.getByDisplayValue('My film')).toBeTruthy()
    expect(createProject).not.toHaveBeenCalled()
    expect(createGuidedProject).not.toHaveBeenCalled()
  })
})
