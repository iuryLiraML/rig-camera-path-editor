// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'

vi.mock('../lib/projects', () => ({
  bootProjects: vi.fn(),
  createProject: vi.fn(async () => 'proj-new'),
  loadShot: vi.fn(),
  moveProjectToFolder: vi.fn(),
  removeFolder: vi.fn(),
  switchProject: vi.fn(),
}))

vi.mock('../lib/folders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/folders')>()
  return {
    ...actual,
    createFolder: vi.fn(async () => ({
      id: 'folder-1',
      name: 'Untitled folder',
      createdAt: 1,
      updatedAt: 1,
    })),
    renameFolder: vi.fn(),
  }
})

import { createProject } from '../lib/projects'
import { createFolder } from '../lib/folders'
import { ProjectsWorkspace } from './ProjectsWorkspace'

beforeEach(() => {
  useProjectStore.setState({
    projectList: [],
    folderList: [],
    projectBusy: false,
    projectId: '',
    folderId: null,
  })
  useCloudAuthStore.setState({ status: 'signed-out', session: null, error: null })
  useEditorStore.setState({ appView: 'projects' })
  vi.mocked(createProject).mockClear()
  vi.mocked(createFolder).mockClear()
})

afterEach(() => {
  cleanup()
})

describe('ProjectsWorkspace', () => {
  it('creates a project from the header and opens the editor', async () => {
    const { getAllByTitle } = render(<ProjectsWorkspace />)
    fireEvent.click(getAllByTitle('Opens the editor with the Director pane')[0])
    await waitFor(() => expect(createProject).toHaveBeenCalledWith('New project', null))
    expect(useEditorStore.getState().appView).toBe('editor')
  })

  it('creates a project from the empty dashed card', async () => {
    const { getAllByTitle } = render(<ProjectsWorkspace />)
    const card = getAllByTitle('Opens the editor with the Director pane').at(-1)
    fireEvent.click(card!)
    await waitFor(() => expect(createProject).toHaveBeenCalledWith('New project', null))
  })

  it('creates a folder from New folder', async () => {
    const { getByRole } = render(<ProjectsWorkspace />)
    fireEvent.click(getByRole('button', { name: 'New folder' }))
    await waitFor(() => expect(createFolder).toHaveBeenCalled())
  })

  it('does not show the unfiled-empty copy when there are no folders either', () => {
    const { container } = render(<ProjectsWorkspace />)
    expect(container.textContent).not.toContain('No unfiled projects')
  })
})
