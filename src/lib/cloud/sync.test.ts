import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRecord } from '../../lib/projects'

const memory = new Map<string, unknown>()
vi.mock('../../lib/idb', () => ({
  idbUpdate: vi.fn(async (_store: string, id: string, update: (value: any) => any) => {
    const current = memory.get(id)
    if (!current) return undefined
    const next = structuredClone(update(structuredClone(current)))
    memory.set(id, next)
    return next
  }),
  STORES: { projects: 'projects', buffers: 'buffers' },
  idbGet: vi.fn(async (store: string, id: string) => store === 'buffers' ? new Uint8Array([1, 2, 3]).buffer : structuredClone(memory.get(id))),
  idbPut: vi.fn(async (_store: string, record: ProjectRecord) => { memory.set(record.id, structuredClone(record)) }),
}))
vi.mock('../../lib/cloud/client', async (original) => ({
  ...await original<typeof import('../../lib/cloud/client')>(),
  createCloudProject: vi.fn(async () => ({ id: `cloud-${Math.random()}`, updatedAt: 'v1' })),
  updateCloudProject: vi.fn(async () => ({ updatedAt: 'v2' })),
  uploadCloudBytes: vi.fn(async () => ({ assetId: `asset-${Math.random()}`, sha256: 'same-content-hash' })),
  sha256Hex: vi.fn(async () => 'same-content-hash'),
}))
import { syncProjectToCloud } from '../../lib/cloud/sync'
import { createCloudProject, updateCloudProject, uploadCloudBytes } from '../../lib/cloud/client'
import { useCloudAuthStore } from '../../state/useCloudAuthStore'
import { createLegacyProjectWorkflow } from '../../lib/projectWorkflow'
import { makeEmptyRigSnapshot } from '../../state/useCameraOptionsStore'
import { useSaveStatusStore } from '../saveStatus'

function record(): ProjectRecord {
  return {
    id: 'local-audit', name: 'Original title', createdAt: 1, updatedAt: 1,
    workflow: createLegacyProjectWorkflow('Original title'), guidelines: '',
    savedPrompts: [], skills: [], activeSceneId: 'scene-audit',
    scenes: [{ id: 'scene-audit', name: 'Scene', createdAt: 1, order: 0,
      sceneMeta: [], rig: makeEmptyRigSnapshot(), shots: [] }],
  }
}

beforeEach(() => {
  memory.clear()
  vi.clearAllMocks()
  useCloudAuthStore.setState({ accessToken: 'audit-test-token', status: 'signed-in', saveConflict: null })
})

describe('Cloud sync audit: mocked network, real sync coordinator', () => {
  it('keeps another project’s unresolved conflict when this project finishes syncing', async () => {
    memory.set('local-audit', record())
    const conflict = { projectId: 'other-project', updatedAt: 'remote-v3' }
    useCloudAuthStore.getState().setSaveConflict(conflict)
    await syncProjectToCloud('local-audit')
    expect(useCloudAuthStore.getState().saveConflict).toEqual(conflict)
  })
  it('creates one cloud project when two sync requests overlap for the same local project', async () => {
    memory.set('local-audit', record())
    await Promise.all([syncProjectToCloud('local-audit'), syncProjectToCloud('local-audit')])
    expect(createCloudProject).toHaveBeenCalledTimes(1)
  })

  it('preserves a newer local edit when an older cloud response arrives', async () => {
    const old = { ...record(), cloudProjectId: 'cloud-existing', cloudUpdatedAt: 'v1' }
    memory.set(old.id, old)
    let release!: (value: { updatedAt: string }) => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    vi.mocked(updateCloudProject).mockImplementationOnce(async () => {
      entered()
      return new Promise<{ updatedAt: string }>((resolve) => { release = resolve }).then((response) => ({ ...response, id: 'cloud-existing', name: old.name, workflowVersion: 1, workflow: {}, editorState: {} }))
    })
    const pending = syncProjectToCloud(old.id)
    await started
    memory.set(old.id, { ...old, name: 'Newer local edit', updatedAt: 2 })
    release({ updatedAt: 'v2' })
    await pending
    expect((memory.get(old.id) as ProjectRecord).name).toBe('Newer local edit')
    expect(vi.mocked(updateCloudProject).mock.calls.at(-1)?.[2].name).toBe('Newer local edit')
  })

  it('keeps a failed revision pending and retries without creating another cloud project', async () => {
    const stored = { ...record(), contentRevision: 'revision-1' }
    memory.set(stored.id, stored)
    vi.mocked(updateCloudProject).mockRejectedValueOnce(new Error('Network unavailable'))
    await expect(syncProjectToCloud(stored.id)).rejects.toThrow('Network unavailable')
    expect(useSaveStatusStore.getState().cloud[stored.id]).toBe('error')
    expect((memory.get(stored.id) as ProjectRecord).cloudSyncedRevision).toBeUndefined()
    await syncProjectToCloud(stored.id)
    expect(createCloudProject).toHaveBeenCalledTimes(1)
    expect((memory.get(stored.id) as ProjectRecord).cloudSyncedRevision).toBe('revision-1')
    expect(useSaveStatusStore.getState().cloud[stored.id]).toBe('saved')
  })

  it('does not upload identical unchanged model bytes twice during overlapping saves', async () => {
    const stored = { ...record(), cloudProjectId: 'cloud-existing', cloudUpdatedAt: 'v1' }
    stored.scenes[0].sceneMeta.push({ id: 'asset-object', name: 'Asset', shade: 0.5, bufferKey: 'buffer-a', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, keys: [], playClips: false })
    memory.set(stored.id, stored)
    await Promise.all([syncProjectToCloud(stored.id), syncProjectToCloud(stored.id)])
    expect(uploadCloudBytes).toHaveBeenCalledTimes(1)
  })

  it('reuses uploaded model bytes in sequential saves', async () => {
    const stored = { ...record(), cloudProjectId: 'cloud-existing', cloudUpdatedAt: 'v1' }
    stored.scenes[0].sceneMeta.push({ id: 'asset-object', name: 'Asset', shade: 0.5, bufferKey: 'buffer-a', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, keys: [], playClips: false })
    memory.set(stored.id, stored)
    await syncProjectToCloud(stored.id)
    await syncProjectToCloud(stored.id)
    expect(uploadCloudBytes).toHaveBeenCalledTimes(1)
  })
})
