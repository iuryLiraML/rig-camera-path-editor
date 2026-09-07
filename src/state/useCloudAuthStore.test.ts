import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/cloud/client', async (original) => ({
  ...await original<typeof import('../lib/cloud/client')>(),
  fetchCloudSession: vi.fn(async () => ({ userId: 'user-a', tenantId: 'tenant-a', email: 'a@silverside.ai', name: 'A', picture: null })),
  listOwnCredentials: vi.fn(async () => []),
}))
import { fetchCloudSession, listOwnCredentials } from '../lib/cloud/client'
import { useCloudAuthStore } from './useCloudAuthStore'

afterEach(async () => {
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
})
