// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const memory = new Map<string, unknown>()
vi.mock('./idb', () => ({
  STORES: { projects: 'projects', buffers: 'buffers', folders: 'folders' },
  idbGet: vi.fn(async (store: string, id: string) => store === 'projects' ? structuredClone(memory.get(id)) : undefined),
  idbGetAll: vi.fn(async (store: string) => store === 'projects' ? structuredClone([...memory.values()]) : []),
  idbPut: vi.fn(async (store: string, record: { id: string }) => { if (store === 'projects') memory.set(record.id, structuredClone(record)) }),
  idbUpdate: vi.fn(async (_store: string, id: string, update: (record: any) => any) => {
    if (!memory.has(id)) return undefined
    const next = update(structuredClone(memory.get(id)))
    memory.set(id, structuredClone(next))
    return next
  }),
  idbDelete: vi.fn(async (_store: string, id: string) => { memory.delete(id) }),
  idbKeys: vi.fn(async () => []),
}))
vi.mock('./cloud/sync', async (original) => ({
  ...await original<typeof import('./cloud/sync')>(),
  hydrateCloudProject: vi.fn(),
  syncProjectToCloud: vi.fn(async () => undefined),
  syncActiveProjectToCloud: vi.fn(async () => undefined),
}))
vi.mock('./cloud/client', async (original) => ({
  ...await original<typeof import('./cloud/client')>(),
  isTeamCloudApp: () => false,
  listCloudProjects: vi.fn(async () => []),
  deleteCloudProject: vi.fn(async () => { vi.mocked(listCloudProjects).mockResolvedValue([]) }),
}))

import { createProject, deleteProject, discardUnsyncedProject, saveActiveProject, initializeBlankProjectSession, type ProjectRecord } from './projects'
import { hydrateCloudProject } from './cloud/sync'
import { listCloudProjects, deleteCloudProject } from './cloud/client'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { useProjectStore } from '../state/useProjectStore'

beforeEach(async () => {
  memory.clear()
  localStorage.clear()
  useCloudAuthStore.setState({ status: 'signed-out', accessToken: null, session: null })
  vi.mocked(deleteCloudProject).mockClear()
  vi.mocked(listCloudProjects).mockResolvedValue([])
  await initializeBlankProjectSession()
})
afterEach(async () => {
  useCloudAuthStore.setState({ status: 'signed-out', accessToken: null, session: null })
  await initializeBlankProjectSession()
})

it.each(['shared legacy ID', 'separate local and cloud IDs'])(
  'deleting the active synced project does not multiply local records: %s', async (identity) => {
    const localId = await createProject('Deletion audit fixture')
    const cloudId = identity === 'shared legacy ID' ? localId : 'cloud-deletion-audit'
    const record = structuredClone(memory.get(localId)) as ProjectRecord
    const synced = { ...record, cloudProjectId: cloudId, cloudUpdatedAt: '2026-09-07T00:00:00Z', cloudSyncedRevision: record.contentRevision }
    memory.set(localId, synced)
    vi.mocked(hydrateCloudProject).mockResolvedValue({ ...synced, id: cloudId })
    vi.mocked(listCloudProjects).mockResolvedValue([{
      id: cloudId, name: record.name, workflowVersion: 1, workflow: record.workflow,
      editorState: {}, updatedAt: '2026-09-07T00:00:00Z',
    }])
    useCloudAuthStore.setState({ status: 'signed-in', accessToken: 'audit-token', session: {
      userId: 'audit-user', tenantId: 'audit-tenant', email: null, name: null, picture: null,
    } })

    await deleteProject(localId)

    const observed = { recordIds: [...memory.keys()], cardIds: useProjectStore.getState().projectList.map((p) => p.id) }
    expect(deleteCloudProject).toHaveBeenCalledWith('audit-token', cloudId)
    expect(observed).toEqual({ recordIds: [], cardIds: [] })
    expect(useProjectStore.getState().projectId).toBe('')
  },
)


it('retains the active project when remote deletion fails', async () => {
  const id = await createProject('Keep on failure')
  const record = structuredClone(memory.get(id)) as ProjectRecord
  memory.set(id, { ...record, cloudProjectId: 'remote-failure' })
  useCloudAuthStore.setState({ status: 'signed-in', accessToken: 'audit-token' })
  vi.mocked(deleteCloudProject).mockRejectedValueOnce(new Error('Offline'))
  await expect(deleteProject(id)).rejects.toThrow('Offline')
  expect(memory.has(id)).toBe(true)
  expect(useProjectStore.getState().projectId).toBe(id)
})


it('does not recreate a deleted project when a tab-hide save arrives during remote deletion', async () => {
  const id = await createProject('Delete while saving')
  memory.set(id, { ...memory.get(id) as ProjectRecord, cloudProjectId: 'pending-delete' })
  useCloudAuthStore.setState({ status: 'signed-in', accessToken: 'audit-token' })
  let release!: () => void
  let started!: () => void
  const entered = new Promise<void>((resolve) => { started = resolve })
  vi.mocked(deleteCloudProject).mockImplementationOnce(async () => {
    started()
    await new Promise<void>((resolve) => { release = resolve })
  })
  const removing = deleteProject(id)
  await entered
  const saving = saveActiveProject()
  release()
  await Promise.all([removing, saving])
  expect(memory.size).toBe(0)
  expect(useProjectStore.getState().projectId).toBe('')
})


it('discards only the local copy during sign-out without deleting the cloud project', async () => {
  const id = await createProject('Discard local edits')
  memory.set(id, { ...memory.get(id) as ProjectRecord, cloudProjectId: 'keep-remote' })
  useCloudAuthStore.setState({ status: 'signed-in', accessToken: 'audit-token', pendingSignOut: null })
  await discardUnsyncedProject(id)
  expect(deleteCloudProject).not.toHaveBeenCalled()
  expect(memory.size).toBe(0)
})
