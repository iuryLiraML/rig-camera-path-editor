import { create } from 'zustand'
import { fetchCloudSession, storeProviderCredential } from '../lib/cloud/client'
import type { ProviderKind } from '../lib/agent/providers'

const TOKEN_KEY = 'rig-cloud-access-token'

interface CloudAuthState {
  accessToken: string | null
  session: { userId: string; tenantId: string } | null
  status: 'idle' | 'checking' | 'signed-in' | 'signed-out' | 'error'
  error: string | null
  /** id of the encrypted vault credential stored per AI provider (server-side) */
  credentialIds: Partial<Record<ProviderKind, string>>
  setAccessToken: (token: string | null) => Promise<void>
  bootstrap: () => Promise<void>
  signOut: () => void
  /** store an API key in the encrypted cloud vault; returns the credential id */
  storeCredential: (provider: ProviderKind, secret: string) => Promise<string>
}

export const useCloudAuthStore = create<CloudAuthState>((set, get) => ({
  accessToken: null,
  session: null,
  status: 'idle',
  error: null,
  credentialIds: {},

  async setAccessToken(token) {
    if (!token?.trim()) {
      localStorage.removeItem(TOKEN_KEY)
      set({ accessToken: null, session: null, status: 'signed-out', error: null, credentialIds: {} })
      return
    }

    const trimmed = token.trim()
    localStorage.setItem(TOKEN_KEY, trimmed)
    set({ accessToken: trimmed, status: 'checking', error: null })
    try {
      const session = await fetchCloudSession(trimmed)
      set({ session, status: 'signed-in', error: null })
    } catch (error) {
      localStorage.removeItem(TOKEN_KEY)
      set({
        accessToken: null,
        session: null,
        status: 'error',
        error: error instanceof Error ? error.message : 'Cloud sign-in failed',
      })
    }
  },

  async bootstrap() {
    const envToken = import.meta.env.VITE_DEV_ACCESS_TOKEN?.trim()
    const storedToken = localStorage.getItem(TOKEN_KEY)?.trim()
    const token = storedToken || envToken || null
    if (!token) {
      set({ status: 'signed-out' })
      return
    }
    await get().setAccessToken(token)
  },

  signOut() {
    localStorage.removeItem(TOKEN_KEY)
    set({ accessToken: null, session: null, status: 'signed-out', error: null, credentialIds: {} })
  },

  async storeCredential(provider, secret) {
    const accessToken = get().accessToken
    if (!accessToken) throw new Error('Sign in to the cloud before storing a key')
    const trimmed = secret.trim()
    if (!trimmed) throw new Error('API key is empty')
    const { credentialId } = await storeProviderCredential(accessToken, { provider, secret: trimmed })
    set((state) => ({ credentialIds: { ...state.credentialIds, [provider]: credentialId } }))
    return credentialId
  },
}))
