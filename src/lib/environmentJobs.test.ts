// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setServerKeysForTests } from './agent/serverKeys'
import { resetFalForTests, setFalTransportForTests } from './fal/client'
import { syncFalSettings } from './fal/settings'
import { makeFixtureSplatPly } from './environment'
import { deleteStoredEnvironment, generateEnvironmentFromPhoto } from './environmentJobs'
import { useAgentStore } from '../state/useAgentStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { useProjectStore } from '../state/useProjectStore'
import { useSceneStore } from '../state/useSceneStore'

const { idbMemory } = vi.hoisted(() => ({
  idbMemory: new Map<string, ArrayBuffer>(),
}))

vi.mock('./idb', () => ({
  STORES: { buffers: 'model-buffers', projects: 'projects', folders: 'folders' },
  idbPut: vi.fn(async (_store: string, value: unknown, key?: string) => {
    if (typeof key === 'string') idbMemory.set(key, value as ArrayBuffer)
  }),
  idbGet: vi.fn(async (_store: string, key: string) => idbMemory.get(key)),
  idbDelete: vi.fn(async (_store: string, key: string) => {
    idbMemory.delete(key)
  }),
  idbKeys: vi.fn(async () => [...idbMemory.keys()]),
  idbGetAll: vi.fn(async () => [...idbMemory.values()]),
}))

afterEach(() => {
  resetFalForTests()
  syncFalSettings('', '3.1')
  setServerKeysForTests(null)
  idbMemory.clear()
  useAgentStore.setState({ falKey: '' })
  useSceneStore.setState({ pendingLifts: [], notice: null })
  useEnvironmentStore.setState({
    environments: [],
    unplacedAssets: [],
    sceneBindings: [],
    environmentId: null,
    liveBuffer: null,
    liveFormat: null,
    sourceImage: null,
  })
  try {
    sessionStorage.removeItem('rig:last-env-error')
  } catch {
    /* jsdom */
  }
})

describe('deleteStoredEnvironment', () => {
  it('refuses to delete a palco the live scene still uses', () => {
    useProjectStore.setState({ activeSceneId: 'scene-a' })
    useEnvironmentStore.setState({
      environments: [{ id: 'beach', name: 'Beach', bufferKey: 'b', source: 'import', createdAt: 1 }],
      unplacedAssets: [],
      sceneBindings: [{ id: 'scene-a', environmentId: 'beach' }],
      environmentId: 'beach',
    })
    expect(deleteStoredEnvironment('beach')).toBe('Used in 1 scene')
    expect(useEnvironmentStore.getState().environments).toHaveLength(1)
  })

  it('deletes when no scene points at it', () => {
    useProjectStore.setState({ activeSceneId: 'scene-a' })
    useEnvironmentStore.setState({
      environments: [{ id: 'beach', name: 'Beach', bufferKey: 'b', source: 'import', createdAt: 1 }],
      unplacedAssets: [],
      sceneBindings: [{ id: 'scene-a', environmentId: null }],
      environmentId: null,
    })
    expect(deleteStoredEnvironment('beach')).toBeNull()
    expect(useEnvironmentStore.getState().environments).toEqual([])
  })
})

describe('hydrateEnvironment', () => {
  it('unloads the previous splat from GPU state', () => {
    useEnvironmentStore.setState({
      liveBuffer: new ArrayBuffer(8),
      liveFormat: 'splat',
      environmentId: 'old',
    })
    useEnvironmentStore.getState().hydrate({ environments: [], unplacedAssets: [], environmentId: null })
    expect(useEnvironmentStore.getState().liveBuffer).toBeNull()
    expect(useEnvironmentStore.getState().liveFormat).toBeNull()
    expect(useEnvironmentStore.getState().environmentId).toBeNull()
  })
})

describe('generateEnvironmentFromPhoto', () => {
  it('starts TripoSplat when Settings has a Fal key even if configureFal was never called', async () => {
    useAgentStore.setState({ falKey: 'user-byok-key' })
    syncFalSettings('user-byok-key', '3.1')
    const ply = makeFixtureSplatPly()
    let uploaded = false
    setFalTransportForTests({
      upload: async () => {
        uploaded = true
        return 'https://cdn.example/photo.jpg'
      },
      subscribe: async () => ({
        model_mesh: { url: 'https://cdn.example/room.ply', file_name: 'room.ply' },
      }),
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(ply, { status: 200 })) as typeof fetch
    try {
      const id = await generateEnvironmentFromPhoto(
        new File([new Uint8Array([1, 2, 3])], 'room.jpg', { type: 'image/jpeg' }),
      )
      expect(uploaded).toBe(true)
      expect(id).toBeTruthy()
      expect(useEnvironmentStore.getState().environments).toHaveLength(1)
      expect(useEnvironmentStore.getState().environmentId).toBe(id)
      expect(useSceneStore.getState().notice).toBe('Environment ready')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
