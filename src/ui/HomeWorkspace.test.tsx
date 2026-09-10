// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useEditorStore } from '../state/useEditorStore'

vi.mock('../lib/projects', () => ({
  createProject: vi.fn(async () => 'proj-1'),
  goLibrary: vi.fn(async () => true),
  goProjects: vi.fn(async () => true),
  goHome: vi.fn(async () => true),
}))
vi.mock('../lib/library', () => ({
  importLibraryAsset: vi.fn(async () => 'env-1'),
}))

import { HomeWorkspace } from './HomeWorkspace'
import { goLibrary, goProjects } from '../lib/projects'

afterEach(() => {
  cleanup()
  useEditorStore.setState({ appView: 'home' })
})

describe('HomeWorkspace', () => {
  it('offers the four live tiles and no Coming generate/pose controls', () => {
    const { getByRole, queryByText } = render(<HomeWorkspace />)
    expect(getByRole('button', { name: /Start with AI or open a blank scene/ })).toBeTruthy()
    expect(getByRole('button', { name: /Import assets/ })).toBeTruthy()
    expect(getByRole('button', { name: /Account shelf/ })).toBeTruthy()
    expect(getByRole('button', { name: /document list/ })).toBeTruthy()
    expect(queryByText('Generate 3D')).toBeNull()
    expect(queryByText('Poses')).toBeNull()
    expect(queryByText('Coming')).toBeNull()
  })

  it('opens Library and Projects from the tiles', () => {
    const { getByRole } = render(<HomeWorkspace />)
    fireEvent.click(getByRole('button', { name: /Account shelf/ }))
    fireEvent.click(getByRole('button', { name: /document list/ }))
    expect(goLibrary).toHaveBeenCalled()
    expect(goProjects).toHaveBeenCalled()
  })
})
