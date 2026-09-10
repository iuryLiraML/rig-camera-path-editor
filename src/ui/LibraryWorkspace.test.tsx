// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useLibraryStore, type LibraryAsset, type LibraryCollection } from '../lib/library'
import { useProjectStore } from '../state/useProjectStore'

vi.mock('../lib/projects', () => ({
  goHome: vi.fn(async () => true),
  goLibrary: vi.fn(async () => true),
  goProjects: vi.fn(async () => true),
}))

const assignAssetToCollectionMock = vi.fn(async (_assetId: string, _collectionId: string | null) => undefined)
const createLibraryCollectionMock = vi.fn(async (_name: string) => 'collection-new')
const deleteLibraryCollectionMock = vi.fn(async (_id: string) => undefined)
const renameLibraryCollectionMock = vi.fn(async (_id: string, _name: string) => undefined)
const addAssetTagMock = vi.fn(async (_assetId: string, _tag: string) => undefined)
const removeAssetTagMock = vi.fn(async (_assetId: string, _tag: string) => undefined)

vi.mock('../lib/library', async (importActual) => {
  const actual = await importActual<typeof import('../lib/library')>()
  return {
    ...actual,
    assignAssetToCollection: (assetId: string, collectionId: string | null) =>
      assignAssetToCollectionMock(assetId, collectionId),
    createLibraryCollection: (name: string) => createLibraryCollectionMock(name),
    deleteLibraryCollection: (id: string) => deleteLibraryCollectionMock(id),
    renameLibraryCollection: (id: string, name: string) => renameLibraryCollectionMock(id, name),
    addAssetTag: (assetId: string, tag: string) => addAssetTagMock(assetId, tag),
    removeAssetTag: (assetId: string, tag: string) => removeAssetTagMock(assetId, tag),
    importLibraryAsset: vi.fn(async () => null),
    createProjectFromAsset: vi.fn(async () => null),
    deleteLibraryAsset: vi.fn(async () => null),
    insertLibraryAssetIntoScene: vi.fn(async () => null),
  }
})

import { LibraryWorkspace } from './LibraryWorkspace'

function makeAsset(overrides: Partial<LibraryAsset> = {}): LibraryAsset {
  return {
    id: 'asset-1',
    name: 'Beach',
    kind: 'location',
    bufferKey: 'asset-1',
    source: 'import',
    format: 'ply',
    createdAt: 1,
    ownerId: 'local',
    collectionId: null,
    tags: [],
    ...overrides,
  }
}

function makeCollection(overrides: Partial<LibraryCollection> = {}): LibraryCollection {
  return { id: 'col-1', name: 'Living room', createdAt: 1, ownerId: 'local', ...overrides }
}

afterEach(() => {
  cleanup()
  useLibraryStore.setState({
    assets: [],
    collections: [],
    selectedId: null,
    filters: { collectionId: 'all', kind: 'all', tag: null, query: '' },
  })
  useProjectStore.setState({ projectId: '' })
  vi.clearAllMocks()
})

describe('LibraryWorkspace', () => {
  it('shows a still so an asset is recognised by picture and name', () => {
    useLibraryStore.setState({
      assets: [
        makeAsset({
          thumbnail: new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], { type: 'image/svg+xml' }),
        }),
      ],
      selectedId: 'asset-1',
    })
    const { getAllByText, container } = render(<LibraryWorkspace />)
    expect(getAllByText('Beach').length).toBeGreaterThan(0)
    expect(container.querySelector('img')).toBeTruthy()
    expect(container.querySelector('.aspect-video')).toBeTruthy()
  })

  it('lists All assets, Unfiled, and collections with counts in the sidebar', () => {
    useLibraryStore.setState({
      assets: [makeAsset(), makeAsset({ id: 'asset-2', name: 'Chair', collectionId: 'col-1' })],
      collections: [makeCollection()],
    })
    const { getByRole, getAllByRole } = render(<LibraryWorkspace />)
    const nav = getByRole('navigation', { name: /collections/i })
    expect(nav.textContent).toContain('All assets')
    expect(nav.textContent).toContain('Unfiled')
    expect(nav.textContent).toContain('Living room')
    const counts = getAllByRole('button', { name: /Living room/ })[0]
    expect(counts?.textContent).toContain('1')
  })

  it('filters the grid to the clicked collection', () => {
    useLibraryStore.setState({
      assets: [makeAsset(), makeAsset({ id: 'asset-2', name: 'Chair', collectionId: 'col-1' })],
      collections: [makeCollection()],
    })
    const { getByRole, queryByText, getByText } = render(<LibraryWorkspace />)
    fireEvent.click(getByRole('button', { name: /^Living room\d+$/ }))
    expect(getByText('Chair')).toBeTruthy()
    expect(queryByText('Beach')).toBeNull()
  })

  it('creates a collection from the sidebar inline input', () => {
    const { getByRole, getByLabelText } = render(<LibraryWorkspace />)
    fireEvent.click(getByRole('button', { name: /New collection/ }))
    const input = getByLabelText('Collection name')
    fireEvent.change(input, { target: { value: 'Stage sets' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(createLibraryCollectionMock).toHaveBeenCalledWith('Stage sets')
  })

  it('moves the selected asset to a collection from the selection bar', () => {
    useLibraryStore.setState({
      assets: [makeAsset()],
      collections: [makeCollection()],
      selectedId: 'asset-1',
    })
    const { getByLabelText } = render(<LibraryWorkspace />)
    fireEvent.change(getByLabelText('Move to collection'), { target: { value: 'col-1' } })
    expect(assignAssetToCollectionMock).toHaveBeenCalledWith('asset-1', 'col-1')
  })

  it('filters the grid by kind chips', () => {
    useLibraryStore.setState({
      assets: [
        makeAsset(),
        makeAsset({ id: 'asset-2', name: 'Chair', kind: 'model', format: 'glb' }),
      ],
    })
    const { getByRole, queryByText, getByText } = render(<LibraryWorkspace />)
    fireEvent.click(getByRole('button', { name: 'Models' }))
    expect(getByText('Chair')).toBeTruthy()
    expect(queryByText('Beach')).toBeNull()
    fireEvent.click(getByRole('button', { name: 'Locations' }))
    expect(getByText('Beach')).toBeTruthy()
    expect(queryByText('Chair')).toBeNull()
  })

  it('filters the grid when a card tag chip is clicked', () => {
    useLibraryStore.setState({
      assets: [
        makeAsset({ tags: ['hero'] }),
        makeAsset({ id: 'asset-2', name: 'Chair', tags: ['furniture'] }),
      ],
    })
    const { getAllByRole, queryByText, getByText } = render(<LibraryWorkspace />)
    const chip = getAllByRole('button', { name: 'furniture' })[0]!
    fireEvent.click(chip)
    expect(getByText('Chair')).toBeTruthy()
    expect(queryByText('Beach')).toBeNull()
  })

  it('searches by name and by tag', () => {
    useLibraryStore.setState({
      assets: [
        makeAsset({ tags: ['hero'] }),
        makeAsset({ id: 'asset-2', name: 'Chair', tags: ['furniture'] }),
      ],
    })
    const { getByLabelText, queryByText, getByText } = render(<LibraryWorkspace />)
    const search = getByLabelText('Search assets')
    fireEvent.change(search, { target: { value: 'chair' } })
    expect(getByText('Chair')).toBeTruthy()
    expect(queryByText('Beach')).toBeNull()
    fireEvent.change(search, { target: { value: 'hero' } })
    expect(getByText('Beach')).toBeTruthy()
    expect(queryByText('Chair')).toBeNull()
  })

  it('adds a tag to the selected asset from the selection bar', () => {
    useLibraryStore.setState({
      assets: [makeAsset()],
      selectedId: 'asset-1',
    })
    const { getByLabelText } = render(<LibraryWorkspace />)
    const input = getByLabelText('Add tag')
    fireEvent.change(input, { target: { value: 'Hero' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(addAssetTagMock).toHaveBeenCalledWith('asset-1', 'Hero')
  })

  it('removes a tag from the selected asset', () => {
    useLibraryStore.setState({
      assets: [makeAsset({ tags: ['hero', 'furniture'] })],
      selectedId: 'asset-1',
    })
    const { getByRole } = render(<LibraryWorkspace />)
    fireEvent.click(getByRole('button', { name: 'Remove tag hero' }))
    expect(removeAssetTagMock).toHaveBeenCalledWith('asset-1', 'hero')
  })

  it('keeps collection row actions visible for keyboard focus', () => {
    useLibraryStore.setState({
      assets: [makeAsset()],
      collections: [makeCollection()],
    })
    const { getByLabelText } = render(<LibraryWorkspace />)
    const rename = getByLabelText('Rename collection Living room')
    const cluster = rename.closest('span')
    expect(cluster?.className).toContain('focus-within:opacity-100')
  })

  it('explains an empty filtered view', () => {
    useLibraryStore.setState({
      assets: [makeAsset({ tags: ['hero'] })],
      filters: { collectionId: 'all', kind: 'all', tag: 'furniture', query: '' },
    })
    const { getByText } = render(<LibraryWorkspace />)
    expect(getByText(/Nothing tagged/)).toBeTruthy()
  })

  it('explains an empty kind filter', () => {
    useLibraryStore.setState({
      assets: [makeAsset()],
      filters: { collectionId: 'all', kind: 'model', tag: null, query: '' },
    })
    const { getByText } = render(<LibraryWorkspace />)
    expect(getByText('No models yet')).toBeTruthy()
  })

  it('shows Create project for a selected Location', () => {
    useLibraryStore.setState({ assets: [makeAsset()], selectedId: 'asset-1' })
    const { getByRole, queryByRole } = render(<LibraryWorkspace />)
    expect(getByRole('button', { name: 'Create project' })).toBeTruthy()
    expect(queryByRole('button', { name: /Insert into scene|New project with this asset/ })).toBeNull()
  })

  it('shows New project with this asset for a Model when no project is open', () => {
    useProjectStore.setState({ projectId: '' })
    useLibraryStore.setState({
      assets: [makeAsset({ kind: 'model', format: 'glb' })],
      selectedId: 'asset-1',
    })
    const { getByRole, queryByRole } = render(<LibraryWorkspace />)
    expect(getByRole('button', { name: 'New project with this asset' })).toBeTruthy()
    expect(queryByRole('button', { name: 'Create project' })).toBeNull()
  })

  it('shows Insert into scene for a Model when a project is open', () => {
    useProjectStore.setState({ projectId: 'proj-open' })
    useLibraryStore.setState({
      assets: [makeAsset({ kind: 'model', format: 'glb' })],
      selectedId: 'asset-1',
    })
    const { getByRole } = render(<LibraryWorkspace />)
    expect(getByRole('button', { name: 'Insert into scene' })).toBeTruthy()
  })
})
