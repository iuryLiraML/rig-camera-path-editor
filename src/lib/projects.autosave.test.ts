// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const memory = new Map<string, unknown>()
vi.mock('../lib/idb', () => ({
  idbUpdate: vi.fn(async (_store: string, id: string, update: (value: any) => any) => {
    const current = memory.get(id)
    if (!current) return undefined
    const next = structuredClone(update(structuredClone(current)))
    memory.set(id, next)
    return next
  }),
  STORES: { projects: 'projects', buffers: 'buffers', folders: 'folders' },
  idbPut: vi.fn(async (store: string, value: { id: string }) => {
    if (store === 'projects') memory.set(value.id, structuredClone(value))
  }),
  idbGet: vi.fn(async (store: string, id: string) => store === 'projects' ? structuredClone(memory.get(id)) : undefined),
  idbGetAll: vi.fn(async (store: string) => store === 'projects' ? structuredClone([...memory.values()]) : []),
  idbKeys: vi.fn(async () => []),
  idbDelete: vi.fn(async (_store: string, id: string) => { memory.delete(id) }),
}))
vi.mock('../lib/cloud/sync', () => ({
  deleteSyncedProject: vi.fn(async (id: string) => { memory.delete(id) }),
  hydrateCloudProject: vi.fn(),
  syncActiveProjectToCloud: vi.fn(async () => undefined),
  syncProjectToCloud: vi.fn(async () => undefined),
}))
vi.mock('../lib/cloud/client', async (original) => ({
  ...await original<typeof import('../lib/cloud/client')>(),
  isTeamCloudApp: () => false,
  listCloudProjects: vi.fn(async () => []),
}))

import {
  bootProjects, goProjects, saveActiveProject, switchProject, createProject, deleteProject,
  initializeBlankProjectSession, openBlankProjectSession, renameProject, renameScene, deleteScene, beginSignOut, AUTOSAVE_MS, type ProjectRecord,
} from '../lib/projects'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { useSceneStore } from '../state/useSceneStore'
import { useRigStore } from '../state/useRigStore'
import { useSaveStatusStore } from '../lib/saveStatus'
import { idbGet, idbPut, idbUpdate } from '../lib/idb'
import { syncProjectToCloud } from './cloud/sync'
import { useCloudAuthStore } from '../state/useCloudAuthStore'

const originalSignOut = useCloudAuthStore.getState().signOut

beforeEach(async () => {
  vi.useFakeTimers()
  memory.clear()
  localStorage.clear()
  useCloudAuthStore.setState({ status: 'signed-out', accessToken: null, session: null, pendingSignOut: null, signOut: originalSignOut })
  useEditorStore.setState({ appView: 'editor' })
  await initializeBlankProjectSession()
  await bootProjects()
  useEditorStore.setState({ appView: 'editor' })
  vi.mocked(idbPut).mockClear()
})
afterEach(async () => {
  useCloudAuthStore.setState({ status: 'signed-out', accessToken: null, session: null, pendingSignOut: null, signOut: originalSignOut })
  vi.mocked(syncProjectToCloud).mockReset().mockResolvedValue(undefined)
  await initializeBlankProjectSession()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('Projects autosave audit: expected product behavior', () => {
  it.each(['project', 'scene'] as const)('syncs a %s renamed from another project card with a new content revision', async (kind) => {
    const targetId = await createProject('Background project')
    const currentId = await createProject('Current project')
    const target = structuredClone(memory.get(targetId)) as ProjectRecord
    target.cloudSyncedRevision = target.contentRevision
    memory.set(targetId, target)
    vi.mocked(syncProjectToCloud).mockClear()
    if (kind === 'project') await renameProject(targetId, 'Renamed in Projects')
    else await renameScene(target.activeSceneId, 'Renamed scene', targetId)
    const changed = memory.get(targetId) as ProjectRecord
    expect(changed.contentRevision).not.toBe(target.contentRevision)
    expect(changed.contentRevision).not.toBe(changed.cloudSyncedRevision)
    expect(syncProjectToCloud).toHaveBeenCalledWith(targetId)
    expect(useProjectStore.getState().projectId).toBe(currentId)
  })

  it('syncs scene removal after persisting it, rather than acknowledging the pre-delete snapshot', async () => {
    const id = await createProject('Two scenes')
    const original = structuredClone(memory.get(id)) as ProjectRecord
    const second = { ...structuredClone(original.scenes[0]), id: 'scene-delete', name: 'Remove me' }
    memory.set(id, { ...original, scenes: [...original.scenes, second] })
    const sceneCounts: number[] = []
    vi.mocked(syncProjectToCloud).mockImplementation(async (projectId) => {
      sceneCounts.push((memory.get(projectId) as ProjectRecord).scenes.length)
    })
    await deleteScene(second.id)
    expect((memory.get(id) as ProjectRecord).scenes).toHaveLength(1)
    expect(sceneCounts.at(-1)).toBe(1)
  })

  it('protects an edited draft when cloud sign-out starts before the first autosave', async () => {
    const signOut = vi.fn(async () => undefined)
    useCloudAuthStore.setState({
      status: 'signed-in', accessToken: 'test-token',
      session: { userId: 'test-user', tenantId: 'test-tenant', email: 'test@silverside.ai', name: 'Test', picture: null },
      signOut,
    })
    useSceneStore.getState().addPrimitive('box')
    await beginSignOut()
    expect(memory.size).toBe(1)
    const saved = [...memory.values()][0] as ProjectRecord
    expect(saved.scenes[0].sceneMeta).toHaveLength(1)
    expect(signOut).not.toHaveBeenCalled()
    expect(useCloudAuthStore.getState().pendingSignOut).toEqual([{ id: saved.id, name: saved.name }])
  })

  it('waits for a card rename before opening that project', async () => {
    const targetId = await createProject('Old card title')
    const currentId = await createProject('Current project')
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const update = vi.mocked(idbUpdate).getMockImplementation()!
    vi.mocked(idbUpdate).mockImplementationOnce(async (store, id, edit) => {
      entered()
      await new Promise<void>((resolve) => { release = resolve })
      return update(store, id, edit)
    })
    const rename = renameProject(targetId, 'New card title')
    await started
    const opening = switchProject(targetId)
    await vi.advanceTimersByTimeAsync(0)
    const beforeRelease = useProjectStore.getState().projectId
    release()
    await Promise.all([rename, opening])
    expect(beforeRelease).toBe(currentId)
    expect(useProjectStore.getState().name).toBe('New card title')
  })
  it('preserves an edited draft when New project is clicked before the debounce', async () => {
    useSceneStore.getState().addPrimitive('box')
    await createProject('Second project')
    expect(memory.size).toBe(2)
    const original = [...memory.values()].find((r) => (r as ProjectRecord).name === 'Untitled') as ProjectRecord
    expect(original.scenes[0].sceneMeta).toHaveLength(1)
  })

  it('persists the current draft before browser navigation opens a blank session', async () => {
    useSceneStore.getState().addPrimitive('box')
    await openBlankProjectSession()
    expect(memory.size).toBe(1)
    expect(([...memory.values()][0] as ProjectRecord).scenes[0].sceneMeta).toHaveLength(1)
    expect(useProjectStore.getState().projectId).toBe('')
    expect(useSceneStore.getState().objects).toHaveLength(0)
  })

  it('does not replace the last deleted project with a new empty project', async () => {
    await createProject('Delete this fixture')
    await deleteProject(useProjectStore.getState().projectId)
    expect(memory.size).toBe(0)
    expect(useEditorStore.getState().appView).toBe('home')
  })
  it('does not persist an untouched blank session when opening Projects', async () => {
    expect(memory.size).toBe(0)
    expect(useSaveStatusStore.getState().status).toBe('saved')
    await goProjects()
    expect(memory.size).toBe(0)
  })

  it('does not accumulate empty projects across three launch-to-Projects visits', async () => {
    for (let visit = 0; visit < 3; visit++) {
      await bootProjects()
      await goProjects()
    }
    expect(memory.size).toBe(0)
  })

  it('does not create a project for a transient notice', async () => {
    useSceneStore.getState().showNotice('Diagnostic notice only')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 1)
    expect(memory.size).toBe(0)
  })

  it('does not create a project when scrubbing time without authored content', async () => {
    useRigStore.getState().setT(0.5)
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 1)
    expect(memory.size).toBe(0)
  })

  it('updates one existing record across repeated saves and Projects round-trips', async () => {
    useProjectStore.getState().setName('Audit project')
    await saveActiveProject()
    const id = useProjectStore.getState().projectId
    for (let visit = 0; visit < 3; visit++) {
      await goProjects()
      await switchProject(id)
      useEditorStore.getState().setAppView('editor')
      await saveActiveProject()
    }
    expect([...memory.keys()]).toEqual([id])
  })

  it('includes the just-autosaved project in Projects immediately', async () => {
    useSceneStore.getState().addPrimitive('box')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 1)
    await goProjects()
    expect(memory.size).toBe(1)
    expect(useProjectStore.getState().projectList.map((p) => p.id)).toEqual([...memory.keys()])
  })

  it('does not rewrite a saved project merely to show and dismiss a notice', async () => {
    useSceneStore.getState().addPrimitive('box')
    await saveActiveProject()
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2)
    vi.mocked(idbPut).mockClear()
    vi.mocked(idbUpdate).mockClear()
    useSceneStore.getState().showNotice('A UI-only notice', 1200)
    await vi.advanceTimersByTimeAsync(2500)
    expect(idbPut).not.toHaveBeenCalled()
    expect(idbUpdate).not.toHaveBeenCalled()
  })

  it('does not save another project under an old ID when an autosave overlaps switching', async () => {
    useProjectStore.getState().setName('Project A')
    await saveActiveProject()
    const aId = useProjectStore.getState().projectId
    const a = structuredClone(memory.get(aId)) as ProjectRecord
    const b: ProjectRecord = { ...structuredClone(a), id: 'audit-b', name: 'Project B' }
    memory.set(b.id, b)
    let release!: (record: ProjectRecord) => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => { started = resolve })
    vi.mocked(idbGet).mockImplementationOnce(async () => {
      started()
      return new Promise<ProjectRecord>((resolve) => { release = resolve })
    })
    const pending = saveActiveProject()
    await entered
    const switching = switchProject(b.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(useProjectStore.getState().projectId).toBe(aId)
    release(a)
    await Promise.all([pending, switching])
    expect((memory.get(aId) as ProjectRecord).name).toBe('Project A')
  })

  it('keeps a newer edit dirty while an older snapshot finishes saving', async () => {
    useProjectStore.getState().setName('Captured title')
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    vi.mocked(idbGet).mockImplementationOnce(async () => {
      entered()
      await new Promise<void>((resolve) => { release = resolve })
      return undefined
    })
    const pending = saveActiveProject()
    await started
    useProjectStore.getState().setName('Newer title')
    release()
    await pending
    const id = useProjectStore.getState().projectId
    expect((memory.get(id) as ProjectRecord).name).toBe('Captured title')
    expect(useSaveStatusStore.getState().status).toBe('dirty')
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 1)
    expect((memory.get(id) as ProjectRecord).name).toBe('Newer title')
  })
})
