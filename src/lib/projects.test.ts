// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLegacyProjectWorkflow } from './projectWorkflow'
import { useEditorStore } from '../state/useEditorStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { useProjectStore } from '../state/useProjectStore'
import { useSaveStatusStore } from './saveStatus'
import { CAMERA_PATH_ID, makeAnchor, usePathStore } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'
import { useCameraOptionsStore } from '../state/useCameraOptionsStore'
import { useSceneStore } from '../state/useSceneStore'
import { LEGACY_META_KEY } from './sceneIO'

const memory = new Map<string, { id: string; name: string; [key: string]: unknown }>()

vi.mock('./idb', () => ({
  STORES: { buffers: 'model-buffers', projects: 'projects', folders: 'folders' },
  idbPut: vi.fn(async (_store: string, value: { id: string; name: string }) => {
    memory.set(value.id, value)
  }),
  idbGet: vi.fn(async (_store: string, key: string) => memory.get(key)),
  idbGetAll: vi.fn(async () => [...memory.values()]),
  idbKeys: vi.fn(async () => []),
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

import {
  AUTOSAVE_MS,
  bootProjects,
  flushActiveProject,
  installPersistFlush,
  liveBufferKeys,
  renameProject,
  saveActiveProject,
  scheduleAutosave,
  switchScene,
  type ProjectRecord,
} from './projects'
import { idbGet, idbGetAll, idbPut, STORES } from './idb'
import { makeEmptyRigSnapshot } from '../state/useCameraOptionsStore'

beforeEach(() => {
  memory.clear()
  localStorage.clear()
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
    activeSceneId: 'scene-1',
    sceneName: 'Scene 1',
    scenes: [{ id: 'scene-1', name: 'Scene 1' }],
    shots: [],
    directorChat: [],
    directorLessons: [],
    folderId: null,
    projectList: [],
  })
  useEnvironmentStore.getState().hydrate({ environments: [], unplacedAssets: [] })
  const emptyRig = makeEmptyRigSnapshot()
  usePathStore.setState({
    paths: [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
    activePathId: CAMERA_PATH_ID,
    selectedAnchorRefs: [],
    primaryAnchorRef: null,
    selectedAnchorId: null,
    selectedAnchorIds: [],
    selectedHandle: 'none',
    drawPlaneY: 1.2,
  })
  useCameraOptionsStore.getState().loadOptions(undefined, undefined, emptyRig)
  useRigStore.setState({ playing: false, t: 0 })
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

describe('renameProject', () => {
  it('renames the live project and writes the new title', async () => {
    useProjectStore.setState({ projectId: 'proj-live', name: 'Old title' })
    await renameProject('proj-live', '  Hero shot  ')
    expect(useProjectStore.getState().name).toBe('Hero shot')
    expect(memory.get('proj-live')?.name).toBe('Hero shot')
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

describe('legacy record migration', () => {
  it('synthesizes one scene from a pre-Scene-tier record on read', async () => {
    const emptyRig = makeEmptyRigSnapshot()
    memory.set('proj-legacy', {
      id: 'proj-legacy',
      name: 'Old project',
      createdAt: 1,
      guidelines: 'Keep it moody',
      savedPrompts: [],
      skills: [],
      shots: [
        {
          id: 'shot-1',
          name: 'Shot 1',
          order: 0,
          rig: emptyRig,
          format: { aspect: '16:9', res: 1080, custom: [1920, 1080] },
          duration: 6,
          thumbnail: null,
        },
      ],
      directorChat: [],
      directorLessons: [],
      sceneMeta: [],
      rig: emptyRig,
    } as unknown as { id: string; name: string })

    await renameProject('proj-legacy', 'Renamed project')

    const migrated = memory.get('proj-legacy') as unknown as ProjectRecord
    expect(migrated.name).toBe('Renamed project')
    expect(migrated.scenes).toHaveLength(1)
    expect(migrated.activeSceneId).toBe(migrated.scenes[0].id)
    expect(migrated.scenes[0].shots).toHaveLength(1)
    expect(migrated.scenes[0].shots[0].id).toBe('shot-1')
    expect(migrated.guidelines).toBe('Keep it moody')
  })
})

describe('liveBufferKeys', () => {
  const emptyRig = makeEmptyRigSnapshot()

  it('keeps a buffer referenced only by an inactive scene in the same project', () => {
    const records: ProjectRecord[] = [
      {
        id: 'proj-1',
        name: 'Multi-scene',
        createdAt: 1,
        guidelines: '',
        savedPrompts: [],
        skills: [],
        activeSceneId: 'scene-a',
        scenes: [
          { id: 'scene-a', name: 'A', order: 0, createdAt: 1, sceneMeta: [], rig: emptyRig, shots: [] },
          {
            id: 'scene-b',
            name: 'B',
            order: 1,
            createdAt: 1,
            sceneMeta: [
              {
                id: 'obj-1',
                name: 'Hull',
                shade: 0.4,
                bufferKey: 'buf-scene-b',
                transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
                keys: [],
                playClips: false,
              },
            ],
            rig: emptyRig,
            shots: [],
          },
        ],
      },
    ]
    // the live stage currently shows (empty) scene A — scene B's buffer isn't "live" right now, but must survive
    const keys = liveBufferKeys(records, [])
    expect(keys.has('buf-scene-b')).toBe(true)
  })

  it('drops a buffer no scene in any project references', () => {
    const records: ProjectRecord[] = [
      {
        id: 'proj-1',
        name: 'P',
        createdAt: 1,
        guidelines: '',
        savedPrompts: [],
        skills: [],
        activeSceneId: 'scene-a',
        scenes: [{ id: 'scene-a', name: 'A', order: 0, createdAt: 1, sceneMeta: [], rig: emptyRig, shots: [] }],
      },
    ]
    const keys = liveBufferKeys(records, [])
    expect(keys.has('buf-orphan')).toBe(false)
  })

  it('keeps environment and unplaced buffers on the project', () => {
    const records: ProjectRecord[] = [
      {
        id: 'proj-1',
        name: 'P',
        createdAt: 1,
        guidelines: '',
        savedPrompts: [],
        skills: [],
        activeSceneId: 'scene-a',
        scenes: [
          {
            id: 'scene-a',
            name: 'A',
            order: 0,
            createdAt: 1,
            sceneMeta: [],
            rig: emptyRig,
            shots: [],
            environmentId: 'env-1',
          },
        ],
        environments: [
          { id: 'env-1', name: 'Beach', bufferKey: 'env-buf', source: 'triposplat', createdAt: 1 },
        ],
        unplacedAssets: [{ id: 'a1', name: 'Chair', bufferKey: 'chair-buf', rigKind: 'none' }],
      },
    ]
    const keys = liveBufferKeys(records, [])
    expect(keys.has('env-buf')).toBe(true)
    expect(keys.has('chair-buf')).toBe(true)
  })
})

describe('switchScene', () => {
  it('switches the active scene and preserves both scenes in storage', async () => {
    const emptyRig = makeEmptyRigSnapshot()
    useProjectStore.setState({
      projectId: 'proj-multi',
      name: 'Multi',
      activeSceneId: 'scene-a',
      sceneName: 'Scene A',
      scenes: [
        { id: 'scene-a', name: 'Scene A' },
        { id: 'scene-b', name: 'Scene B' },
      ],
    })
    memory.set('proj-multi', {
      id: 'proj-multi',
      name: 'Multi',
      createdAt: 1,
      guidelines: '',
      savedPrompts: [],
      skills: [],
      activeSceneId: 'scene-a',
      scenes: [
        { id: 'scene-a', name: 'Scene A', order: 0, createdAt: 1, sceneMeta: [], rig: emptyRig, shots: [], paths: [] },
        { id: 'scene-b', name: 'Scene B', order: 1, createdAt: 1, sceneMeta: [], rig: emptyRig, shots: [], paths: [] },
      ],
    } as unknown as { id: string; name: string })

    await switchScene('scene-b')
    expect(useProjectStore.getState().activeSceneId).toBe('scene-b')
    expect(useProjectStore.getState().sceneName).toBe('Scene B')

    const afterSwitch = memory.get('proj-multi') as unknown as ProjectRecord
    expect(afterSwitch.scenes.map((s) => s.id).sort()).toEqual(['scene-a', 'scene-b'])

    await switchScene('scene-a')
    expect(useProjectStore.getState().activeSceneId).toBe('scene-a')
    expect(useProjectStore.getState().sceneName).toBe('Scene A')
  })
})

describe('non-cloud boot', () => {
  const keyFields = [
    'progressKeys',
    'fovKeys',
    'rollKeys',
    'intensityKeys',
    'fadeInKeys',
    'fadeOutKeys',
    'ampPosKeys',
    'ampRotKeys',
    'freqKeys',
    'staticPosXKeys',
    'staticPosYKeys',
    'staticPosZKeys',
    'staticRotXKeys',
    'staticRotYKeys',
    'staticRotZKeys',
    'lookOffsetXKeys',
    'lookOffsetYKeys',
    'lookOffsetZKeys',
    'targetXKeys',
    'targetYKeys',
    'targetZKeys',
  ] as const

  it('preserves saved records but opens a blank unsaved editor session', async () => {
    const savedRig = {
      ...makeEmptyRigSnapshot(),
      anchors: [makeAnchor([0, 1, 0]), makeAnchor([2, 1, 2])],
      progressKeys: [{ id: 'progress-1', time: 0, progress: 0 }],
      fovKeys: [{ id: 'fov-1', time: 0.5, value: 70 }],
    }
    memory.set('proj-saved', {
      id: 'proj-saved',
      name: 'Saved work',
      createdAt: 1,
      updatedAt: 2,
      guidelines: '',
      savedPrompts: [],
      skills: [],
      activeSceneId: 'scene-saved',
      scenes: [{
        id: 'scene-saved',
        name: 'Saved scene',
        order: 0,
        createdAt: 1,
        sceneMeta: [],
        rig: savedRig,
        paths: [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: savedRig.anchors, closed: false, rounding: 0.8 }],
        shots: [],
      }],
    })
    localStorage.setItem('rig-active-project', 'proj-saved')
    useRigStore.setState({
      playing: true,
      t: 0.75,
      progressKeys: savedRig.progressKeys,
      fovKeys: savedRig.fovKeys,
    })

    await bootProjects()

    expect(memory.get('proj-saved')?.name).toBe('Saved work')
    expect(memory.size).toBe(1)
    expect(idbPut).not.toHaveBeenCalled()
    expect(useProjectStore.getState().projectList.map((project) => project.id)).toEqual(['proj-saved'])
    expect(useProjectStore.getState().projectId).toBe('')
    expect(localStorage.getItem('rig-active-project')).toBeNull()
    expect(useProjectStore.getState().shots).toEqual([])
    expect(useEditorStore.getState().appView).toBe('editor')
    expect(usePathStore.getState().getPath(CAMERA_PATH_ID)?.anchors).toEqual([])
    expect(useRigStore.getState().t).toBe(0)
    expect(useRigStore.getState().playing).toBe(false)
    for (const field of keyFields) expect(useRigStore.getState()[field]).toEqual([])
    expect(useCameraOptionsStore.getState().options).toHaveLength(1)
    expect(useCameraOptionsStore.getState().options[0].pristine).toBe(true)
  })

  it('opens a blank unsaved editor on first run without creating a project', async () => {
    await bootProjects()

    expect(memory.size).toBe(0)
    expect(idbPut).not.toHaveBeenCalled()
    expect(useProjectStore.getState().projectId).toBe('')
    expect(useProjectStore.getState().projectList).toEqual([])
    expect(useEditorStore.getState().appView).toBe('editor')
    expect(usePathStore.getState().getPath(CAMERA_PATH_ID)?.anchors).toEqual([])
    expect(useSceneStore.getState().objects).toHaveLength(1)

    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(useSaveStatusStore.getState().status).toBe('saved'))
    expect(memory.size).toBe(0)
    expect(idbPut).not.toHaveBeenCalled()
  })

  it('preserves actual legacy scene metadata in a project before opening blank', async () => {
    localStorage.setItem(LEGACY_META_KEY, JSON.stringify([{
      id: 'legacy-object',
      name: 'Legacy object',
      shade: 0.4,
      bufferKey: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      keys: [],
      playClips: false,
    }]))

    await bootProjects()

    expect(memory.size).toBe(1)
    const preserved = [...memory.values()][0] as unknown as ProjectRecord
    expect(preserved.scenes[0].sceneMeta.map((meta) => meta.name)).toContain('Legacy object')
    expect(useProjectStore.getState().projectList).toHaveLength(1)
    expect(useProjectStore.getState().projectId).toBe('')
    expect(useSceneStore.getState().objects).toHaveLength(1)
  })
})
