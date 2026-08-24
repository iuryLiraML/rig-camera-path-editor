import { useProjectStore, type CustomSkill, type DirectorChatEntry, type SavedPrompt, type Shot } from '../state/useProjectStore'
import { useSceneStore, makeSceneId } from '../state/useSceneStore'
import { applyRigSnapshot, getRigSnapshot, useRigStore, type RigSnapshot } from '../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore, type MotionPath } from '../state/usePathStore'
import { useEditorStore } from '../state/useEditorStore'
import { useAgentStore } from '../state/useAgentStore'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import {
  getCameraOptionsSnapshot,
  makeEmptyRigSnapshot,
  useCameraOptionsStore,
  type CameraOption,
} from '../state/useCameraOptionsStore'
import { idbDelete, idbGet, idbGetAll, idbPut, STORES } from './idb'
import { CloudConflictError, createCloudProject, isTeamCloudApp, listCloudProjects } from './cloud/client'
import { hydrateCloudProject, syncActiveProjectToCloud } from './cloud/sync'
import { liveSceneMetas, loadSceneFromMetas, readLegacyMetas, sweepOrphanBuffers, type ObjectMeta } from './sceneIO'
import { resetHistory, setHistorySuspended } from './history'
import { renderBridge } from './renderBridge'
import { captureShotStill } from './recorder'
import {
  PROJECT_WORKFLOW_VERSION,
  createLegacyProjectWorkflow,
  isProjectEditorReady,
  migrateProjectWorkflow,
  type ProjectWorkflow,
} from './projectWorkflow'
import { deleteFolder as deleteFolderRecord, listFolders } from './folders'
import { setPersistFlusher } from './persistFlush'
import { useSaveStatusStore } from './saveStatus'

const ACTIVE_KEY = 'rig-active-project'
export const AUTOSAVE_MS = 800

export interface ProjectAssetRef {
  assetId: string
  sha256: string
}

export interface ProjectRecord {
  id: string
  name: string
  createdAt: number
  /** last save; optional for records written before the Projects screen showed it */
  updatedAt?: number
  cloudProjectId?: string
  cloudUpdatedAt?: string
  bufferAssets?: Record<string, ProjectAssetRef>
  stillAssets?: Record<string, ProjectAssetRef>
  /** folder on the Projects home; missing on records written before folders */
  folderId?: string | null
  workflow?: ProjectWorkflow
  guidelines: string
  savedPrompts: SavedPrompt[]
  skills: CustomSkill[]
  shots: Shot[]
  directorChat?: DirectorChatEntry[]
  directorLessons?: string[]
  sceneMeta: ObjectMeta[]
  rig: RigSnapshot
  /** full motion-path collection (incl. the camera path); optional for back-compat */
  paths?: MotionPath[]
  /** named camera alternatives; optional for projects created before multi-camera support */
  cameraOptions?: CameraOption[]
  activeCameraOptionId?: string
}

function isCloudFirst(): boolean {
  return useCloudAuthStore.getState().status === 'signed-in'
}

function buildActiveRecord(id: string, createdAt: number): ProjectRecord {
  const project = useProjectStore.getState()
  return {
    id,
    name: project.name,
    createdAt,
    updatedAt: Date.now(),
    workflow: project.workflow,
    guidelines: project.guidelines,
    savedPrompts: project.savedPrompts,
    skills: project.skills,
    shots: project.shots,
    directorChat: project.directorChat,
    directorLessons: project.directorLessons,
    folderId: project.folderId,
    sceneMeta: liveSceneMetas(),
    rig: getRigSnapshot(),
    paths: JSON.parse(JSON.stringify(usePathStore.getState().paths)),
    cameraOptions: getCameraOptionsSnapshot(),
    activeCameraOptionId: useCameraOptionsStore.getState().activeOptionId,
  }
}

const createdAtById = new Map<string, number>()
let creatingUntitled: Promise<string | null> | null = null

function restoreDirectorChat() {
  useAgentStore.getState().clearChat()
  useAgentStore.getState().hydrateDirectorChat()
}

/**
 * Assigns an id to the live editor session without wiping the scene — unlike
 * "New project", which starts from an empty rig. Used when autosave/unload
 * runs before the user has ever named a project.
 */
async function createUntitledFromCurrent(): Promise<string | null> {
  const current = useProjectStore.getState()
  const name = current.name.trim() || 'Untitled'
  let id = makeSceneId('proj')
  let cloudUpdatedAt: string | undefined
  if (isCloudFirst()) {
    const accessToken = useCloudAuthStore.getState().accessToken
    if (accessToken) {
      const created = await createCloudProject(accessToken, {
        name,
        workflowVersion: PROJECT_WORKFLOW_VERSION,
        workflow: current.workflow,
        editorState: {},
      })
      id = created.id
      cloudUpdatedAt = created.updatedAt
    }
  }
  createdAtById.set(id, Date.now())
  current.loadProject({
    projectId: id,
    name,
    workflow: current.workflow,
    guidelines: current.guidelines,
    savedPrompts: current.savedPrompts,
    skills: current.skills,
    shots: current.shots,
    directorChat: current.directorChat,
    directorLessons: current.directorLessons,
    folderId: current.folderId,
  })
  localStorage.setItem(ACTIVE_KEY, id)
  if (cloudUpdatedAt) {
    const createdAt = createdAtById.get(id) ?? Date.now()
    await idbPut(STORES.projects, {
      ...buildActiveRecord(id, createdAt),
      cloudProjectId: id,
      cloudUpdatedAt,
    })
  }
  await refreshProjectList()
  return id
}

async function ensureActiveProjectId(createIfMissing: boolean): Promise<string | null> {
  const existing = useProjectStore.getState().projectId
  if (existing) return existing
  if (!createIfMissing) return null
  // Projects home with no open session — do not spawn an untitled on tab hide.
  if (useEditorStore.getState().appView === 'projects') return null
  if (creatingUntitled) return creatingUntitled
  creatingUntitled = createUntitledFromCurrent().finally(() => {
    creatingUntitled = null
  })
  return creatingUntitled
}

/** Persists the active project (debounced by watchers, immediate on switch). */
export async function saveActiveProject(options?: { createIfMissing?: boolean }) {
  const createIfMissing = options?.createIfMissing ?? true
  useSaveStatusStore.getState().setStatus('saving')
  try {
    const projectId = await ensureActiveProjectId(createIfMissing)
    if (!projectId) {
      // Projects home has nothing to persist. An editor session without an id
      // failed to create — do not show Saved.
      const idle = useEditorStore.getState().appView === 'projects'
      useSaveStatusStore.getState().setStatus(idle ? 'saved' : 'dirty')
      return
    }
    const createdAt = createdAtById.get(projectId) ?? Date.now()
    createdAtById.set(projectId, createdAt)
    const previous = await idbGet<ProjectRecord>(STORES.projects, projectId)
    const record: ProjectRecord = {
      ...buildActiveRecord(projectId, createdAt),
      cloudProjectId: previous?.cloudProjectId ?? (isCloudFirst() ? projectId : undefined),
      cloudUpdatedAt: previous?.cloudUpdatedAt,
      bufferAssets: previous?.bufferAssets,
      stillAssets: previous?.stillAssets,
    }
    await idbPut(STORES.projects, record)
    useSaveStatusStore.getState().setStatus('saved')
    void syncActiveProjectToCloud().catch((error) => {
      if (error instanceof CloudConflictError) {
        useCloudAuthStore.getState().setSaveConflict({
          projectId,
          updatedAt: error.updatedAt,
        })
        return
      }
      console.error('Cloud sync failed', error)
      if (isCloudFirst()) {
        useSceneStore.getState().showNotice(
          error instanceof Error ? error.message : 'Cloud save failed. The project is not durable offline.',
        )
      }
    })
  } catch (error) {
    useSaveStatusStore.getState().setStatus('dirty')
    throw error
  }
}

/** Skip the autosave debounce and write now (Ctrl+S, key insert, tab hide). */
export function flushActiveProject(options?: { createIfMissing?: boolean }) {
  clearTimeout(saveTimer)
  return saveActiveProject(options)
}

function sceneSummaries(shots: Shot[] | undefined) {
  return [...(shots ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((shot) => ({ id: shot.id, name: shot.name }))
}

function shotsFromUnknown(value: unknown): Shot[] {
  if (!Array.isArray(value)) return []
  return value.filter((shot): shot is Shot => {
    if (!shot || typeof shot !== 'object') return false
    const record = shot as { id?: unknown; name?: unknown }
    return typeof record.id === 'string' && typeof record.name === 'string'
  })
}

async function refreshFolderList() {
  const folders = await listFolders()
  useProjectStore.getState().setFolderList(folders)
  return folders
}

async function refreshProjectList() {
  await refreshFolderList()
  if (isCloudFirst()) {
    const accessToken = useCloudAuthStore.getState().accessToken
    if (!accessToken) {
      useProjectStore.getState().setProjectList([])
      return []
    }
    const cloud = await listCloudProjects(accessToken)
    const local = await idbGetAll<ProjectRecord>(STORES.projects)
    const localById = new Map(local.map((record) => [record.id, record]))
    cloud.forEach((project) => {
      const createdAt = Date.parse(project.updatedAt) || Date.now()
      createdAtById.set(project.id, createdAt)
    })
    useProjectStore.getState().setProjectList(
      cloud.map((project) => {
        const workflow = migrateProjectWorkflow(project.workflow, project.name)
        const editorState = project.editorState
        const shots = shotsFromUnknown(
          editorState && typeof editorState === 'object'
            ? (editorState as { shots?: unknown }).shots
            : [],
        )
        return {
          id: project.id,
          name: project.name,
          setupStatus: isProjectEditorReady(workflow) ? 'ready' : 'draft',
          folderId: localById.get(project.id)?.folderId ?? null,
          shotCount: shots.length,
          updatedAt: Date.parse(project.updatedAt) || Date.now(),
          scenes: sceneSummaries(shots),
        }
      }),
    )
    return [] as ProjectRecord[]
  }

  const records = await idbGetAll<ProjectRecord>(STORES.projects)
  records.forEach((r) => createdAtById.set(r.id, r.createdAt))
  // most recently touched first: that is the order you actually look for
  const byRecency = [...records].sort(
    (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
  )
  useProjectStore.getState().setProjectList(
    byRecency.map((record) => {
      const workflow = migrateProjectWorkflow(record.workflow, record.name)
      const shots = record.shots ?? []
      return {
        id: record.id,
        name: record.name,
        setupStatus: isProjectEditorReady(workflow) ? 'ready' : 'draft',
        folderId: record.folderId ?? null,
        shotCount: shots.length,
        updatedAt: record.updatedAt ?? record.createdAt,
        thumbnail: [...shots].sort((a, b) => a.order - b.order)[0]?.thumbnail ?? undefined,
        scenes: sceneSummaries(shots),
      }
    }),
  )
  records.sort((a, b) => a.createdAt - b.createdAt)
  return records
}

function applyRecord(record: ProjectRecord) {
  useProjectStore.getState().loadProject({
    projectId: record.id,
    name: record.name,
    workflow: migrateProjectWorkflow(record.workflow, record.name),
    guidelines: record.guidelines,
    savedPrompts: record.savedPrompts ?? [],
    skills: record.skills ?? [],
    shots: record.shots ?? [],
    directorChat: record.directorChat ?? [],
    directorLessons: record.directorLessons ?? [],
    folderId: record.folderId ?? null,
  })
  // restore the whole path collection first, then let the rig snapshot
  // upsert the camera path (keeps old records without `paths` working)
  usePathStore.setState({
    paths: record.paths?.length
      ? JSON.parse(JSON.stringify(record.paths))
      : [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
    activePathId: CAMERA_PATH_ID,
    selectedAnchorId: null,
    selectedAnchorIds: [],
    selectedHandle: 'none',
  })
  useCameraOptionsStore
    .getState()
    .loadOptions(record.cameraOptions, record.activeCameraOptionId, record.rig)
  localStorage.setItem(ACTIVE_KEY, record.id)
  useSaveStatusStore.getState().setStatus('saved')
}

let watching = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
let autosaveSuspended = false
let persistFlushInstalled = false

export function scheduleAutosave() {
  if (autosaveSuspended) return
  useSaveStatusStore.getState().setStatus('dirty')
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void saveActiveProject().catch((error) => console.error('Failed to autosave project', error))
  }, AUTOSAVE_MS)
}

function flushNow() {
  void flushActiveProject().catch((error) => console.error('Failed to flush project', error))
}

/** Tab hide only — `beforeunload` still fires while visibility is `visible`. */
function onVisibilityFlush() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') return
  flushNow()
}

/** Write on hide / unload so an 800ms debounce cannot drop the last edit. */
export function installPersistFlush() {
  if (persistFlushInstalled || typeof window === 'undefined') return
  persistFlushInstalled = true
  window.addEventListener('beforeunload', flushNow)
  window.addEventListener('pagehide', flushNow)
  document.addEventListener('visibilitychange', onVisibilityFlush)
}

function watchForAutosave() {
  if (watching) return
  watching = true
  setPersistFlusher(() => {
    void flushActiveProject().catch((error) => console.error('Failed to flush project', error))
  })
  installPersistFlush()
  useSceneStore.subscribe(scheduleAutosave)
  useRigStore.subscribe((s) => {
    if (!s.playing) scheduleAutosave() // playback t updates are not worth writes
  })
  usePathStore.subscribe(scheduleAutosave) // path geometry lives here now
  useCameraOptionsStore.subscribe(scheduleAutosave)
  useProjectStore.subscribe(scheduleAutosave)
}

async function openHydratedRecord(record: ProjectRecord) {
  applyRecord(record)
  await loadSceneFromMetas(record.sceneMeta, true)
  restoreDirectorChat()
}

async function loadCloudRecord(projectId: string): Promise<ProjectRecord> {
  const record = await hydrateCloudProject(projectId)
  createdAtById.set(record.id, record.createdAt)
  await idbPut(STORES.projects, record)
  return record
}

export async function reloadActiveProjectFromCloud() {
  const projectId = useProjectStore.getState().projectId
  if (!projectId) return
  const record = await loadCloudRecord(projectId)
  await openHydratedRecord(record)
  useCloudAuthStore.getState().setSaveConflict(null)
}

function resetEditorChrome() {
  const editor = useEditorStore.getState()
  editor.select(null)
  editor.setPlayMode(false)
  editor.setCameraView(false)
  useRigStore.getState().setPlaying(false)
}

/** Boot: load the active project, or migrate the pre-projects world into one. */
export async function bootProjects() {
  if (isTeamCloudApp() && !isCloudFirst()) {
    useProjectStore.getState().setProjectList([])
    useProjectStore.setState({ projectId: '' })
    useEditorStore.getState().setAppView('projects')
    watchForAutosave()
    useProjectStore.getState().setBooted(true)
    return
  }

  if (isCloudFirst()) {
    await refreshProjectList()
    const list = useProjectStore.getState().projectList
    if (list.length === 0) {
      useProjectStore.setState({ projectId: '' })
      useEditorStore.getState().setAppView('projects')
    } else {
      const activeId = localStorage.getItem(ACTIVE_KEY)
      const summary = list.find((project) => project.id === activeId) ?? list[0]
      const record = await loadCloudRecord(summary.id)
      await openHydratedRecord(record)
    }
    watchForAutosave()
    useProjectStore.getState().setBooted(true)
    return
  }

  const records = await refreshProjectList()

  if (records.length === 0) {
    // first run (or migration from v0.1): adopt whatever local state exists
    const legacyMetas = readLegacyMetas() ?? []
    await loadSceneFromMetas(legacyMetas, true)
    const id = makeSceneId('proj')
    createdAtById.set(id, Date.now())
    useProjectStore.getState().loadProject({
      projectId: id,
      name: 'Untitled',
      workflow: createLegacyProjectWorkflow('Untitled'),
      guidelines: useAgentStore.getState().guidelines, // legacy location
      savedPrompts: [],
      skills: [],
      shots: [],
    })
    localStorage.setItem(ACTIVE_KEY, id)
    await saveActiveProject()
    await refreshProjectList()
  } else {
    const activeId = localStorage.getItem(ACTIVE_KEY)
    const record = records.find((r) => r.id === activeId) ?? records[0]
    await openHydratedRecord(record)
  }

  watchForAutosave()
  useProjectStore.getState().setBooted(true)

  // sweep buffers no project references anymore
  const live = new Set<string>()
  for (const r of await idbGetAll<ProjectRecord>(STORES.projects)) {
    r.sceneMeta.forEach((m) => m.bufferKey && live.add(m.bufferKey))
  }
  liveSceneMetas().forEach((m) => m.bufferKey && live.add(m.bufferKey))
  void sweepOrphanBuffers(live)
}

let projectTransition = Promise.resolve()
let pendingProjectTransitions = 0

function serializeProjectTransition<T>(operation: () => Promise<T>): Promise<T> {
  const run = projectTransition.then(operation, operation)
  projectTransition = run.then(
    () => undefined,
    () => undefined,
  )
  pendingProjectTransitions += 1
  useProjectStore.getState().setProjectBusy(true)
  const finish = () => {
    pendingProjectTransitions -= 1
    if (pendingProjectTransitions === 0) useProjectStore.getState().setProjectBusy(false)
  }
  void run.then(finish, finish)
  return run
}

async function switchProjectNow(id: string) {
  const { projectId } = useProjectStore.getState()
  if (id === projectId) return
  clearTimeout(saveTimer)
  await saveActiveProject({ createIfMissing: false })
  resetEditorChrome()

  if (isCloudFirst()) {
    const record = await loadCloudRecord(id)
    await openHydratedRecord(record)
    resetHistory()
    useSceneStore.getState().showNotice(`Switched to "${record.name}"`)
    return
  }

  const records = await idbGetAll<ProjectRecord>(STORES.projects)
  const record = records.find((r) => r.id === id)
  if (!record) return

  await openHydratedRecord(record)
  resetHistory()
  useSceneStore.getState().showNotice(`Switched to "${record.name}"`)
}

export function switchProject(id: string) {
  return serializeProjectTransition(() => switchProjectNow(id))
}

async function createProjectNow(name: string, saveCurrent: boolean, folderId: string | null = null) {
  clearTimeout(saveTimer)
  if (saveCurrent) await saveActiveProject({ createIfMissing: false })

  let id = makeSceneId('proj')
  let cloudUpdatedAt: string | undefined
  const workflow = createLegacyProjectWorkflow(name)
  if (isCloudFirst()) {
    const accessToken = useCloudAuthStore.getState().accessToken
    if (!accessToken) throw new Error('Sign in before creating a cloud project.')
    const created = await createCloudProject(accessToken, {
      name,
      workflowVersion: PROJECT_WORKFLOW_VERSION,
      workflow,
      editorState: {},
    })
    id = created.id
    cloudUpdatedAt = created.updatedAt
  }

  createdAtById.set(id, Date.now())
  useProjectStore.getState().loadProject({
    projectId: id,
    name,
    workflow,
    guidelines: '',
    savedPrompts: [],
    skills: [],
    shots: [],
    folderId,
  })
  localStorage.setItem(ACTIVE_KEY, id)
  await loadSceneFromMetas([], true) // fresh scene with the sample shape
  const emptyRig = makeEmptyRigSnapshot()
  applyRigSnapshot(emptyRig)
  useCameraOptionsStore.getState().loadOptions(undefined, undefined, emptyRig)
  useEditorStore.getState().select(null)
  restoreDirectorChat()
  resetHistory()
  if (cloudUpdatedAt) {
    const createdAt = createdAtById.get(id) ?? Date.now()
    await idbPut(STORES.projects, {
      ...buildActiveRecord(id, createdAt),
      cloudProjectId: id,
      cloudUpdatedAt,
    })
  }
  await saveActiveProject()
  await refreshProjectList()
  useSceneStore.getState().showNotice(`Project "${name}" created`)
  return id
}

export function createProject(name = 'New project', folderId: string | null = null) {
  return serializeProjectTransition(() => createProjectNow(name, true, folderId))
}

export async function renameProject(projectId: string, name: string) {
  const next = name.trim() || 'Untitled'
  const store = useProjectStore.getState()
  if (store.projectId === projectId) {
    store.setName(next)
    await saveActiveProject()
    await refreshProjectList()
    return
  }
  const record = await idbGet<ProjectRecord>(STORES.projects, projectId)
  if (!record) return
  await idbPut(STORES.projects, { ...record, name: next, updatedAt: Date.now() })
  await refreshProjectList()
}

export async function moveProjectToFolder(projectId: string, folderId: string | null) {
  const store = useProjectStore.getState()
  if (store.projectId === projectId) {
    store.setFolderId(folderId)
    await saveActiveProject()
    await refreshProjectList()
    return
  }
  const record = await idbGet<ProjectRecord>(STORES.projects, projectId)
  if (!record) return
  await idbPut(STORES.projects, { ...record, folderId, updatedAt: Date.now() })
  await refreshProjectList()
}

export async function removeFolder(folderId: string) {
  const records = await idbGetAll<ProjectRecord>(STORES.projects)
  const now = Date.now()
  await Promise.all(
    records
      .filter((record) => record.folderId === folderId)
      .map((record) => idbPut(STORES.projects, { ...record, folderId: null, updatedAt: now })),
  )
  const store = useProjectStore.getState()
  if (store.folderId === folderId) store.setFolderId(null)
  await deleteFolderRecord(folderId)
  await refreshProjectList()
}

export { createFolder, renameFolder, listFolders } from './folders'
export type { FolderRecord } from './folders'

async function deleteProjectNow(id: string) {
  clearTimeout(saveTimer)
  await idbDelete(STORES.projects, id)
  createdAtById.delete(id)
  if (isCloudFirst()) {
    await refreshProjectList()
    if (useProjectStore.getState().projectId === id) {
      const remaining = useProjectStore.getState().projectList
      if (remaining.length > 0) {
        await switchProjectNow(remaining[0].id)
      } else {
        useProjectStore.setState({ projectId: '' })
        useEditorStore.getState().setAppView('projects')
      }
    }
    return
  }
  const records = await refreshProjectList()
  if (useProjectStore.getState().projectId === id) {
    if (records.length > 0) {
      await openHydratedRecord(records[0])
      resetHistory()
    } else {
      useProjectStore.setState({ projectId: '' })
      await createProjectNow('Untitled', false)
    }
  }
}

export function deleteProject(id: string) {
  return serializeProjectTransition(() => deleteProjectNow(id))
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

/** Small JPEG of the current viewport for shot cards. */
export async function captureThumbnail(maxWidth = 360): Promise<Blob | null> {
  const canvas = document.querySelector('canvas')
  if (!canvas) return null
  renderBridge.advance?.(performance.now())
  const scale = Math.min(1, maxWidth / canvas.width)
  const copy = document.createElement('canvas')
  copy.width = Math.max(2, Math.round(canvas.width * scale))
  copy.height = Math.max(2, Math.round(canvas.height * scale))
  copy.getContext('2d')!.drawImage(canvas, 0, 0, copy.width, copy.height)
  return new Promise((resolve) => copy.toBlob(resolve, 'image/jpeg', 0.75))
}

export async function saveCurrentAsShot() {
  if ((usePathStore.getState().getPath(CAMERA_PATH_ID)?.anchors.length ?? 0) < 2) {
    useSceneStore.getState().showNotice('Create a camera path before saving a shot')
    return
  }
  const editor = useEditorStore.getState()
  const project = useProjectStore.getState()
  const shot: Shot = {
    id: makeSceneId('shot'),
    name: `Shot ${project.shots.length + 1}`,
    order: project.shots.length,
    rig: getRigSnapshot(),
    format: { aspect: editor.exportAspect, res: editor.exportRes, custom: editor.customSize },
    duration: useRigStore.getState().duration,
    // the clean cinema frame; falls back to the viewport grab if the render
    // bridge is not ready yet
    thumbnail: (await captureShotStill()) ?? (await captureThumbnail()),
  }
  project.addShot(shot)
  useEditorStore.getState().setActiveShotId(shot.id)
  useSceneStore.getState().showNotice(`"${shot.name}" saved — it is in Sequence`)
}

/** Restore a saved take onto the current camera. Does not spawn a new option. */
export function applyShot(shot: Shot) {
  applyRigSnapshot(shot.rig)
  const editor = useEditorStore.getState()
  editor.setExportAspect(shot.format.aspect)
  editor.setExportRes(shot.format.res)
  editor.setCustomSize(shot.format.custom)
  editor.setActiveShotId(shot.id)
}

export function loadShot(shot: Shot) {
  useCameraOptionsStore.getState().createOption(shot.name, shot.rig)
  applyShot(shot)
  const editor = useEditorStore.getState()
  editor.setAppView('editor')
  editor.select('camera-path')
  useSceneStore.getState().showNotice(`"${shot.name}" loaded`)
}

// ---------------------------------------------------------------------------
// Animatic — play all shots in order through the cinema camera
// ---------------------------------------------------------------------------

export async function playAnimatic() {
  const shots = [...useProjectStore.getState().shots].sort((a, b) => a.order - b.order)
  if (shots.length === 0) return

  const previousRig = getRigSnapshot()
  clearTimeout(saveTimer)
  autosaveSuspended = true
  setHistorySuspended(true)
  const editor = useEditorStore.getState()
  editor.setAppView('editor')
  editor.select(null)
  editor.setPlayMode(true)

  try {
    for (const shot of shots) {
      if (!useEditorStore.getState().playMode) break // Esc exited
      applyRigSnapshot({ ...shot.rig, loop: false })
      const rig = useRigStore.getState()
      rig.setT(0)
      rig.setPlaying(true)

      await new Promise<void>((resolve) => {
        const unsub = useRigStore.subscribe((s, prev) => {
          if (prev.playing && !s.playing) finish()
        })
        const poll = setInterval(() => {
          if (!useEditorStore.getState().playMode) finish()
        }, 150)
        const finish = () => {
          unsub()
          clearInterval(poll)
          resolve()
        }
      })
    }
  } finally {
    useEditorStore.getState().setPlayMode(false)
    useRigStore.getState().setPlaying(false)
    applyRigSnapshot(previousRig)
    autosaveSuspended = false
    setHistorySuspended(false)
    void saveActiveProject()
  }
}
