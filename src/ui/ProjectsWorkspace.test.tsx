// @vitest-environment jsdom
import { useProjectCreationStore } from '../state/useProjectCreationStore'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useProjectStore } from '../state/useProjectStore'
import { useEditorStore } from '../state/useEditorStore'

vi.mock('../lib/cloud/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/cloud/client')>()
  return { ...actual, isTeamCloudApp: () => false }
})

vi.mock('../lib/projects', () => ({
  bootProjects: vi.fn(),
  createProject: vi.fn(async () => 'proj-1'),
  deleteProject: vi.fn(),
  goHome: vi.fn(),
  goLibrary: vi.fn(),
  goProjects: vi.fn(),
  moveProjectToFolder: vi.fn(),
  removeFolder: vi.fn(),
  renameProject: vi.fn(),
  renameScene: vi.fn(),
  switchProject: vi.fn(),
  switchScene: vi.fn(),
}))

import { ProjectsWorkspace } from './ProjectsWorkspace'

afterEach(() => {
  cleanup()
  useProjectStore.setState({ projectList: [], folderList: [], projectBusy: false, projectId: '' })
  useEditorStore.setState({ appView: 'projects', workspaceMode: 'compose' })
})

describe('ProjectsWorkspace', () => {
  it('points an empty grid at New project and Import assets on Home', () => {
    useProjectStore.setState({ projectList: [], folderList: [] })
    const { getByText, getAllByText, container, queryByText, queryByPlaceholderText } = render(
      <ProjectsWorkspace />,
    )
    expect(getByText(/Import assets on Home/)).toBeTruthy()
    expect(getAllByText('New project').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-projects-grid] .grid')?.className).toMatch(/xl:grid-cols-3/)
    expect(container.querySelector('[data-projects-grid] .grid')?.className).not.toMatch(/2xl:grid-cols-4/)
    expect(queryByText('Cloud account')).toBeNull()
    expect(queryByPlaceholderText('Development access token')).toBeNull()
  })

  it('offers project creation without immediately opening Build', async () => {
    useEditorStore.setState({ appView: 'projects', workspaceMode: 'compose' })
    const { getAllByText } = render(<ProjectsWorkspace />)
    fireEvent.click(getAllByText('New project')[0]!)
    await waitFor(() => {
      expect(useProjectCreationStore.getState().open).toBe(true)
      expect(useEditorStore.getState().appView).toBe('projects')
    })
  })
})
