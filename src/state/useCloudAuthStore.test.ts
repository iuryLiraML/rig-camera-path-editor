import { afterEach, describe, expect, it, vi } from 'vitest'

const { teamApp, idbClear, idbClearPreservingLibrary } = vi.hoisted(() => ({
  teamApp: { current: false },
  idbClear: vi.fn(async () => undefined),
  idbClearPreservingLibrary: vi.fn(async () => undefined),
}))

vi.mock('../lib/cloud/client', async (original) => ({
  ...await original<typeof import('../lib/cloud/client')>(),
  isTeamCloudApp: () => teamApp.current,
  fetchCloudSession: vi.fn(async () => ({ userId: 'user-a', tenantId: 'tenant-a', email: 'a@silverside.ai', name: 'A', picture: null })),
  listOwnCredentials: vi.fn(async () => []),
}))
vi.mock('../lib/idb', () => ({
  STORES: {
    buffers: 'model-buffers',
    projects: 'projects',
    folders: 'folders',
    assetThumbs: 'asset-thumbs',
    library: 'library-palcos',
  },
  idbClear,
  idbClearPreservingLibrary,
  idbPut: vi.fn(),
  idbGet: vi.fn(),
  idbGetAll: vi.fn(async () => []),
  idbDelete: vi.fn(),
  idbKeys: vi.fn(async () => []),
}))
import { fetchCloudSession, listOwnCredentials } from '../lib/cloud/client'
import { useCloudAuthStore } from './useCloudAuthStore'
import { useLibraryStore } from '../lib/library'

afterEach(async () => {
  teamApp.current = false
  await useCloudAuthStore.getState().setAccessToken(null)
  vi.clearAllMocks()
})

describe('cloud authentication boundaries', () => {
  it('keeps a verified account signed in when the optional vault is unavailable', async () => {
    vi.mocked(listOwnCredentials).mockRejectedValueOnce(new Error('Vault unavailable'))
    await useCloudAuthStore.getState().setAccessToken('test-access-token')
    expect(useCloudAuthStore.getState().status).toBe('signed-in')
    expect(useCloudAuthStore.getState().session?.email).toBe('a@silverside.ai')
  })

  it('does not restore a cancelled session when a delayed authentication request completes', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof fetchCloudSession>>) => void
    vi.mocked(fetchCloudSession).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const pending = useCloudAuthStore.getState().setAccessToken('test-access-token')
    await useCloudAuthStore.getState().setAccessToken(null)
    resolve({ userId: 'user-a', tenantId: 'tenant-a', email: 'a@silverside.ai', name: 'A', picture: null })
    await pending
    expect(useCloudAuthStore.getState().status).toBe('signed-out')
    expect(useCloudAuthStore.getState().session).toBeNull()
  })

  it('keeps the public Library on sign-out', async () => {
    teamApp.current = false
    useLibraryStore.setState({
      assets: [
        {
          id: 'env-keep',
          name: 'Keep',
          kind: 'location',
          bufferKey: 'env-keep',
          source: 'import',
          format: 'ply',
          createdAt: 1,
          ownerId: 'local',
          collectionId: null,
          tags: [],
        },
      ],
      selectedId: 'env-keep',
    })
    await useCloudAuthStore.getState().signOut()
    expect(idbClearPreservingLibrary).toHaveBeenCalled()
    expect(idbClear).not.toHaveBeenCalled()
    expect(useLibraryStore.getState().assets).toHaveLength(1)
  })

  it('wipes the Library on cloud sign-out', async () => {
    teamApp.current = true
    useLibraryStore.setState({
      assets: [
        {
          id: 'env-wipe',
          name: 'Wipe',
          kind: 'location',
          bufferKey: 'env-wipe',
          source: 'import',
          format: 'ply',
          createdAt: 1,
          ownerId: 'user-a',
          collectionId: null,
          tags: [],
        },
      ],
      selectedId: 'env-wipe',
    })
    await useCloudAuthStore.getState().signOut()
    expect(idbClear).toHaveBeenCalled()
    expect(idbClearPreservingLibrary).not.toHaveBeenCalled()
    expect(useLibraryStore.getState().assets).toEqual([])
  })
})
