// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLegacyProjectWorkflow } from './projectWorkflow'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { useSaveStatusStore } from './saveStatus'

const memory = new Map<string, { id: string; name: string }>()

vi.mock('./idb', () => ({
  STORES: { buffers: 'model-buffers', projects: 'projects', folders: 'folders' },
  idbPut: vi.fn(async (_store: string, value: { id: string; name: string }) => {
    memory.set(value.id, value)
  }),
  idbGet: vi.fn(async (_store: string, key: string) => memory.get(key)),
  idbGetAll: vi.fn(async () => [...memory.values()]),
  idbDelete: vi.fn(async (_store: string, key: string) => {
    memory.delete(key)
  }),
}))

vi.mock('./cloud/sync', () => ({
  hydrateCloudProject: vi.fn(),
  syncActiveProjectToCloud: vi.fn(async () => undefined),
}))

vi.mock('./cloud/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cloud/client')>()
  return {
    ...actual,
    isTeamCloudApp: () => false,
    listCloudProjects: vi.fn(async () => []),
  }
})

import { AUTOSAVE_MS, flushActiveProject, installPersistFlush, saveActiveProject, scheduleAutosave } from './projects'
import { idbGet, idbGetAll, idbPut, STORES } from './idb'

beforeEach(() => {
  memory.clear()
  vi.mocked(idbPut).mockClear()
  useSaveStatusStore.setState({ status: 'saved' })
  useEditorStore.setState({ appView: 'editor' })
  useProjectStore.setState({
    projectId: '',
    name: 'Untitled',
    workflow: createLegacyProjectWorkflow('Untitled'),
    guidelines: '',
    savedPrompts: [],
    skills: [],
    shots: [],
    directorChat: [],
    directorLessons: [],
    folderId: null,
    projectList: [],
  })
})

afterEach(() => {
  vi.useRealTimers()
  useProjectStore.setState({ projectId: '' })
})

describe('saveActiveProject', () => {
  it('creates a local untitled project when the id is empty', async () => {
    await saveActiveProject()
    const id = useProjectStore.getState().projectId
    expect(id).toMatch(/^proj/)
    expect(useProjectStore.getState().name).toBe('Untitled')
    expect(memory.get(id)?.name).toBe('Untitled')
    expect(useSaveStatusStore.getState().status).toBe('saved')
  })

  it('creates only one untitled project when two saves race', async () => {
    await Promise.all([saveActiveProject(), saveActiveProject()])
    expect([...memory.keys()]).toHaveLength(1)
    expect(useProjectStore.getState().projectId).toBe([...memory.keys()][0])
  })

  it('keeps Saved on the Projects home and does not spawn a project', async () => {
    useEditorStore.setState({ appView: 'projects' })
    useSaveStatusStore.setState({ status: 'dirty' })
    await saveActiveProject()
    expect(useProjectStore.getState().projectId).toBe('')
    expect(memory.size).toBe(0)
    expect(useSaveStatusStore.getState().status).toBe('saved')
  })

  it('writes the existing id without creating another project', async () => {
    useProjectStore.setState({ projectId: 'proj-keep', name: 'Keep' })
    await saveActiveProject()
    expect(useProjectStore.getState().projectId).toBe('proj-keep')
    expect(memory.get('proj-keep')?.name).toBe('Keep')
    expect([...memory.keys()]).toEqual(['proj-keep'])
  })
})

describe('autosave debounce and unload flush', () => {
  it('debounces the IndexedDB write, then flush on unload writes immediately', async () => {
    useProjectStore.setState({ projectId: 'proj-live', name: 'Live' })
    vi.useFakeTimers()
    scheduleAutosave()
    expect(useSaveStatusStore.getState().status).toBe('dirty')
    expect(idbPut).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1)
    expect(idbPut).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(idbPut).toHaveBeenCalled()
    expect(memory.get('proj-live')?.name).toBe('Live')
    expect(useSaveStatusStore.getState().status).toBe('saved')

    vi.mocked(idbPut).mockClear()
    memory.clear()
    useProjectStore.setState({ name: 'After edit' })
    scheduleAutosave()
    expect(idbPut).not.toHaveBeenCalled()

    await flushActiveProject()
    expect(memory.get('proj-live')?.name).toBe('After edit')
  })

  it('flushes on beforeunload and when the tab hides', async () => {
    useProjectStore.setState({ projectId: 'proj-hide', name: 'Hide me' })
    installPersistFlush()
    window.dispatchEvent(new Event('beforeunload'))
    await vi.waitFor(() => {
      expect(memory.get('proj-hide')?.name).toBe('Hide me')
    })

    memory.clear()
    vi.mocked(idbPut).mockClear()
    useProjectStore.setState({ name: 'Hidden' })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => {
      expect(memory.get('proj-hide')?.name).toBe('Hidden')
    })
  })
})

describe('idbGetAll after save', () => {
  it('round-trips the record so a refresh can reload it', async () => {
    useProjectStore.setState({ projectId: 'proj-round', name: 'Roundtrip' })
    await saveActiveProject()
    const all = await idbGetAll<{ id: string; name: string }>(STORES.projects)
    expect(all.some((record) => record.id === 'proj-round')).toBe(true)
    const stored = await idbGet<{ id: string; name: string }>(STORES.projects, 'proj-round')
    expect(stored?.name).toBe('Roundtrip')
  })
})
