import { create } from 'zustand'
import {
  CLOUD_ACCESS_TOKEN_KEY,
  fetchCloudSession,
  isTeamCloudApp,
  listOwnCredentials,
  retrieveOwnCredential,
  storeProviderCredential,
} from '../lib/cloud/client'
import { idbClear } from '../lib/idb'
import { useAgentStore } from './useAgentStore'
import { useEditorStore } from './useEditorStore'
import { useProjectStore } from './useProjectStore'

const TOKEN_KEY = CLOUD_ACCESS_TOKEN_KEY
let authRequest = 0

// Director credentials stay on the deployment; only Fal uses the personal vault.
export type VaultProvider = 'fal'

export interface CloudSaveConflict {
  projectId: string
  updatedAt: string
}

interface CloudAuthState {
  accessToken: string | null
  session: {
    userId: string
    tenantId: string
    email: string | null
    name: string | null
    picture: string | null
  } | null
  status: 'idle' | 'checking' | 'signed-in' | 'signed-out' | 'error'
  error: string | null
  /** id of the encrypted vault credential stored per AI provider (server-side) */
  credentialIds: Partial<Record<VaultProvider, string>>
  saveConflict: CloudSaveConflict | null
  pendingSignOut: { id: string; name: string }[] | null
  setAccessToken: (token: string | null) => Promise<void>
  bootstrap: () => Promise<void>
  signOut: () => Promise<void>
  setPendingSignOut: (projects: { id: string; name: string }[] | null) => void
  setSaveConflict: (conflict: CloudSaveConflict | null) => void
  /** store an API key in the encrypted cloud vault; returns the credential id */
  storeCredential: (provider: VaultProvider, secret: string) => Promise<string>
}

function clearAgentSecrets() {
  const agent = useAgentStore.getState()
  agent.setFalKey('')
}

async function hydrateVaultSecrets(accessToken: string, current: () => boolean) {
  const listed = await listOwnCredentials(accessToken)
  const credentialIds: Partial<Record<VaultProvider, string>> = {}
  const agent = useAgentStore.getState()
  for (const row of listed) {
    if (!current()) return {}
    if (row.provider !== 'fal') continue
    const retrieved = await retrieveOwnCredential(accessToken, row.id)
    if (!current()) return {}
    if (retrieved.provider === 'fal') {
      agent.setFalKey(retrieved.secret)
      credentialIds.fal = retrieved.id
    }
  }
  return credentialIds
}

export const useCloudAuthStore = create<CloudAuthState>((set, get) => ({
  accessToken: null,
  session: null,
  status: 'idle',
  error: null,
  credentialIds: {},
  saveConflict: null,
  pendingSignOut: null,

  setSaveConflict(conflict) {
    set({ saveConflict: conflict })
  },

  setPendingSignOut(projects) {
    set({ pendingSignOut: projects })
  },

  async setAccessToken(token) {
    const request = ++authRequest
    if (!token?.trim()) {
      localStorage.removeItem(TOKEN_KEY)
      set({
        accessToken: null,
        session: null,
        status: 'signed-out',
        error: null,
        credentialIds: {},
        saveConflict: null,
      })
      return
    }

    const trimmed = token.trim()
    localStorage.setItem(TOKEN_KEY, trimmed)
    set({ accessToken: trimmed, status: 'checking', error: null })
    try {
      const session = await fetchCloudSession(trimmed)
      if (request !== authRequest) return
      let credentialIds: Partial<Record<VaultProvider, string>> = {}
      let vaultError: string | null = null
      try { credentialIds = await hydrateVaultSecrets(trimmed, () => request === authRequest) }
      catch { vaultError = 'Signed in, but saved API keys could not be loaded. Reload to try again.' }
      if (request !== authRequest) return
      set({ session, status: 'signed-in', error: vaultError, credentialIds })
    } catch (error) {
      if (request !== authRequest) return
      localStorage.removeItem(TOKEN_KEY)
      set({
        accessToken: null,
        session: null,
        status: 'error',
        error: error instanceof Error ? error.message : 'Cloud sign-in failed',
        credentialIds: {},
      })
    }
  },

  async bootstrap() {
    const envToken = isTeamCloudApp() ? null : import.meta.env.VITE_DEV_ACCESS_TOKEN?.trim()
    const storedToken = localStorage.getItem(TOKEN_KEY)?.trim()
    const token = storedToken || envToken || null
    if (!token) {
      set({ status: 'signed-out' })
      return
    }
    await get().setAccessToken(token)
  },

  async signOut() {
    authRequest += 1
    set({ accessToken: null, session: null, status: 'signed-out' })
    localStorage.removeItem(TOKEN_KEY)
    clearAgentSecrets()
    await idbClear().catch((error) => console.error('Failed to wipe project cache', error))
    useProjectStore.getState().setProjectList([])
    useProjectStore.setState({ projectId: '' })
    useEditorStore.getState().setAppView('projects')
    set({
      accessToken: null,
      session: null,
      status: 'signed-out',
      error: null,
      credentialIds: {},
      saveConflict: null,
      pendingSignOut: null,
    })
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
