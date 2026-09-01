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
import { hydrateEnvironmentFromRecord, loadLiveEnvironmentBuffer } from './environmentJobs'
import type { ProjectEnvironment, ProjectMeshAsset } from './environment'
import { cloneEnvTransform } from './environment'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
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

/** A place within a project: its own stage, camera, and shots. */
export interface SceneRecord {
  id: string
  name: string
  order: number
  createdAt: number
  /** small JPEG preview, used for the scene switcher */
  thumbnail?: Blob | null
  sceneMeta: ObjectMeta[]
  rig: RigSnapshot
  /** full motion-path collection (incl. the camera path); optional for back-compat */
  paths?: MotionPath[]
  /** named camera alternatives; optional for scenes created before multi-camera support */
  cameraOptions?: CameraOption[]
  activeCameraOptionId?: string
  shots: Shot[]
  directorChat?: DirectorChatEntry[]
  directorLessons?: string[]
  environmentId?: string | null
  environmentTransform?: import('../state/useSceneStore').Transform
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
  activeSceneId: string
  scenes: SceneRecord[]
  environments?: ProjectEnvironment[]
  unplacedAssets?: ProjectMeshAsset[]
}

/**
 * Records written before the Scene tier existed are a flat bundle of one
 * scene's fields at the record root. Detected and grandfathered in on load —
 * see `migrateLegacyRecord` — rather than migrated in a batch pass.
 */
interface LegacyProjectRecord {
  id: string
  name: string
  createdAt: number
  updatedAt?: number
  cloudProjectId?: string
  cloudUpdatedAt?: string
  bufferAssets?: Record<string, ProjectAssetRef>
  stillAssets?: Record<string, ProjectAssetRef>
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
  paths?: MotionPath[]
  cameraOptions?: CameraOption[]
  activeCameraOptionId?: string
  scenes?: undefined
}

/** Deterministic so re-normalizing the same not-yet-resaved legacy record twice agrees with itself. */
const LEGACY_SCENE_ID = 'scene-legacy'

function migrateLegacyRecord(raw: LegacyProjectRecord): ProjectRecord {
  const scene: SceneRecord = {
    id: LEGACY_SCENE_ID,
    name: 'Scene 1',
    order: 0,
    createdAt: raw.createdAt,
    thumbnail: [...(raw.shots ?? [])].sort((a, b) => a.order - b.order)[0]?.thumbnail ?? null,
    sceneMeta: raw.sceneMeta ?? [],
    rig: raw.rig,
    paths: raw.paths,
    cameraOptions: raw.cameraOptions,
    activeCameraOptionId: raw.activeCameraOptionId,
    shots: raw.shots ?? [],
    directorChat: raw.directorChat,
    directorLessons: raw.directorLessons,
  }
  return {
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    cloudProjectId: raw.cloudProjectId,
    cloudUpdatedAt: raw.cloudUpdatedAt,
    bufferAssets: raw.bufferAssets,
    stillAssets: raw.stillAssets,
    folderId: raw.folderId,
    workflow: raw.workflow,
    guidelines: raw.guidelines,
    savedPrompts: raw.savedPrompts ?? [],
    skills: raw.skills ?? [],
    activeSceneId: LEGACY_SCENE_ID,
    scenes: [scene],
  }
}

/** Every read of a stored project record passes through here — old flat shapes get one scene synthesized. */
function normalizeProjectRecord(raw: LegacyProjectRecord | ProjectRecord): ProjectRecord {
  if (Array.isArray(raw.scenes)) return raw as ProjectRecord
  return migrateLegacyRecord(raw as LegacyProjectRecord)
}

async function getProjectRecord(id: string): Promise<ProjectRecord | undefined> {
  const raw = await idbGet<LegacyProjectRecord | ProjectRecord>(STORES.projects, id)
  return raw ? normalizeProjectRecord(raw) : undefined
}

async function getAllProjectRecords(): Promise<ProjectRecord[]> {
  const raw = await idbGetAll<LegacyProjectRecord | ProjectRecord>(STORES.projects)
  return raw.map(normalizeProjectRecord)
}

function activeSceneOf(record: ProjectRecord): SceneRecord {
  return record.scenes.find((s) => s.id === record.activeSceneId) ?? record.scenes[0]
}

function isCloudFirst(): boolean {
  return useCloudAuthStore.getState().status === 'signed-in'
}

function buildActiveScene(id: string, name: string, createdAt: number, previous?: SceneRecord): SceneRecord {
  const project = useProjectStore.getState()
  return {
    id,
    name,
    order: previous?.order ?? 0,
    createdAt,
    thumbnail: previous?.thumbnail ?? null,
    sceneMeta: liveSceneMetas(),
    rig: getRigSnapshot(),
    paths: JSON.parse(JSON.stringify(usePathStore.getState().paths)),
    cameraOptions: getCameraOptionsSnapshot(),
    activeCameraOptionId: useCameraOptionsStore.getState().activeOptionId,
    shots: project.shots,
    directorChat: project.directorChat,
    directorLessons: project.directorLessons,
    environmentId: useEnvironmentStore.getState().environmentId,
    environmentTransform: useEnvironmentStore.getState().environmentId
      ? cloneEnvTransform(useEnvironmentStore.getState().environmentTransform)
      : undefined,
  }
}

/** Captures the live stores into the record, splicing the active scene into whatever else `previous` had saved. */
function buildActiveRecord(id: string, createdAt: number, previous?: ProjectRecord): ProjectRecord {
  const project = useProjectStore.getState()
  const activeSceneId = project.activeSceneId
  const previousScenes = previous?.scenes ?? []
  const index = previousScenes.findIndex((s) => s.id === activeSceneId)
  const activeScene = buildActiveScene(
    activeSceneId,
    project.sceneName,
    createdAt,
    index >= 0 ? previousScenes[index] : undefined,
  )
  const scenes = index >= 0 ? previousScenes.map((s, i) => (i === index ? activeScene : s)) : [...previousScenes, activeScene]
  return {
    id,
    name: project.name,
    createdAt,
    updatedAt: Date.now(),
    workflow: project.workflow,
    guidelines: project.guidelines,
    savedPrompts: project.savedPrompts,
    skills: project.skills,
    folderId: project.folderId,
    activeSceneId,
    scenes,
    environments: useEnvironmentStore.getState().environments,
    unplacedAssets: useEnvironmentStore.getState().unplacedAssets,
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
  let activeSceneId = current.activeSceneId
  let sceneName = current.sceneName.trim() || 'Scene 1'
  let scenes = current.scenes
  if (!activeSceneId) {
    activeSceneId = makeSceneId('scene')
    scenes = [{ id: activeSceneId, name: sceneName }]
  }
  current.loadProject({
    projectId: id,
    name,
    workflow: current.workflow,
    guidelines: current.guidelines,
    savedPrompts: current.savedPrompts,
    skills: current.skills,
    activeSceneId,
    sceneName,
    scenes,
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
    const previous = await getProjectRecord(projectId)
    const record: ProjectRecord = {
      ...buildActiveRecord(projectId, createdAt, previous),
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

function sceneSummaries(scenes: SceneRecord[] | undefined) {
  return [...(scenes ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((scene) => ({ id: scene.id, name: scene.name }))
}

/** Lenient read of a cloud project-list entry's opaque editorState — never throws on a shape mismatch. */
function scenesFromUnknownEditorState(value: unknown): { id: string; name: string; order?: number }[] {
  if (!value || typeof value !== 'object') return []
  const scenes = (value as { scenes?: unknown }).scenes
  if (!Array.isArray(scenes)) return []
  return scenes.filter((s): s is { id: string; name: string; order?: number } => {
    if (!s || typeof s !== 'object') return false
    const r = s as { id?: unknown; name?: unknown }
    return typeof r.id === 'string' && typeof r.name === 'string'
  })
}

function shotCountFromUnknownEditorState(value: unknown): number {
  return scenesFromUnknownEditorState(value).reduce((total, s) => {
    const shots = (s as { shots?: unknown }).shots
    return total + (Array.isArray(shots) ? shots.length : 0)
  }, 0)
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
    const local = await getAllProjectRecords()
    const localById = new Map(local.map((record) => [record.id, record]))
    cloud.forEach((project) => {
      const createdAt = Date.parse(project.updatedAt) || Date.now()
      createdAtById.set(project.id, createdAt)
    })
    useProjectStore.getState().setProjectList(
      cloud.map((project) => {
        const workflow = migrateProjectWorkflow(project.workflow, project.name)
        const scenes = scenesFromUnknownEditorState(project.editorState)
        return {
          id: project.id,
          name: project.name,
          setupStatus: isProjectEditorReady(workflow) ? 'ready' : 'draft',
          folderId: localById.get(project.id)?.folderId ?? null,
          shotCount: shotCountFromUnknownEditorState(project.editorState),
          updatedAt: Date.parse(project.updatedAt) || Date.now(),
          scenes: scenes
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((s) => ({ id: s.id, name: s.name })),
        }
      }),
    )
    return [] as ProjectRecord[]
  }

  const records = await getAllProjectRecords()
  records.forEach((r) => createdAtById.set(r.id, r.createdAt))
  // most recently touched first: that is the order you actually look for
  const byRecency = [...records].sort(
    (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
  )
  useProjectStore.getState().setProjectList(
    byRecency.map((record) => {
      const workflow = migrateProjectWorkflow(record.workflow, record.name)
      const scenes = [...record.scenes].sort((a, b) => a.order - b.order)
      const allShots = scenes.flatMap((s) => s.shots ?? [])
      return {
        id: record.id,
        name: record.name,
        setupStatus: isProjectEditorReady(workflow) ? 'ready' : 'draft',
        folderId: record.folderId ?? null,
        shotCount: allShots.length,
        updatedAt: record.updatedAt ?? record.createdAt,
        thumbnail:
          scenes[0]?.thumbnail ?? [...allShots].sort((a, b) => a.order - b.order)[0]?.thumbnail ?? undefined,
        scenes: sceneSummaries(scenes),
      }
    }),
  )
  records.sort((a, b) => a.createdAt - b.createdAt)
  return records
}

function applyRecord(record: ProjectRecord) {
  const scene = activeSceneOf(record)
  useProjectStore.getState().loadProject({
    projectId: record.id,
    name: record.name,
    workflow: migrateProjectWorkflow(record.workflow, record.name),
    guidelines: record.guidelines,
    savedPrompts: record.savedPrompts ?? [],
    skills: record.skills ?? [],
    activeSceneId: scene.id,
    sceneName: scene.name,
    scenes: sceneSummaries(record.scenes),
    shots: scene.shots ?? [],
    directorChat: scene.directorChat ?? [],
    directorLessons: scene.directorLessons ?? [],
    folderId: record.folderId ?? null,
  })
  // restore the whole path collection first, then let the rig snapshot
  // upsert the camera path (keeps old records without `paths` working)
  usePathStore.setState({
    paths: scene.paths?.length
      ? JSON.parse(JSON.stringify(scene.paths))
      : [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
    activePathId: CAMERA_PATH_ID,
    selectedAnchorId: null,
    selectedAnchorIds: [],
    selectedHandle: 'none',
  })
  useCameraOptionsStore
    .getState()
    .loadOptions(scene.cameraOptions, scene.activeCameraOptionId, scene.rig)
  hydrateEnvironmentFromRecord({
    environments: record.environments,
    unplacedAssets: record.unplacedAssets,
    sceneBindings: record.scenes.map((scene) => ({
      id: scene.id,
      environmentId: scene.environmentId ?? null,
    })),
    environmentId: scene.environmentId,
    environmentTransform: scene.environmentTransform,
  })
  void loadLiveEnvironmentBuffer()
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
  const createIfMissing = useSaveStatusStore.getState().status === 'dirty'
  if (!createIfMissing && !useProjectStore.getState().projectId) return
  void flushActiveProject({ createIfMissing }).catch((error) => console.error('Failed to flush project', error))
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
    const createIfMissing = useSaveStatusStore.getState().status === 'dirty'
    if (!createIfMissing && !useProjectStore.getState().projectId) return
    void flushActiveProject({ createIfMissing }).catch((error) => console.error('Failed to flush project', error))
  })
  installPersistFlush()
  useSceneStore.subscribe(scheduleAutosave)
  useRigStore.subscribe((s) => {
    if (!s.playing) scheduleAutosave() // playback t updates are not worth writes
  })
  usePathStore.subscribe(scheduleAutosave) // path geometry lives here now
  useCameraOptionsStore.subscribe(scheduleAutosave)
  useProjectStore.subscribe(scheduleAutosave)
  useEnvironmentStore.subscribe(scheduleAutosave)
}

async function openHydratedRecord(record: ProjectRecord) {
  applyRecord(record)
  await loadSceneFromMetas(activeSceneOf(record).sceneMeta, true)
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

/**
 * Replaces the live workspace with the pristine, unsaved launch scene.
 * Stored project records are deliberately outside this boundary.
 */
export async function initializeBlankProjectSession() {
  clearTimeout(saveTimer)
  const wasAutosaveSuspended = autosaveSuspended
  autosaveSuspended = true
  try {
    const emptyRig = makeEmptyRigSnapshot()
    useProjectStore.getState().loadProject({
      projectId: '',
      name: 'Untitled',
      workflow: createLegacyProjectWorkflow('Untitled'),
      guidelines: '',
      savedPrompts: [],
      skills: [],
      activeSceneId: '',
      sceneName: 'Scene 1',
      scenes: [],
      shots: [],
      directorChat: [],
      directorLessons: [],
      folderId: null,
    })
    hydrateEnvironmentFromRecord({})
    usePathStore.setState({
      paths: [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
      activePathId: CAMERA_PATH_ID,
      selectedAnchorRefs: [],
      primaryAnchorRef: null,
      selectedAnchorId: null,
      selectedAnchorIds: [],
      selectedHandle: 'none',
      drawPlaneY: emptyRig.drawPlaneY,
    })
    useCameraOptionsStore.getState().loadOptions(undefined, undefined, emptyRig)
    await loadSceneFromMetas([], true)
    restoreDirectorChat()
    resetEditorChrome()
    const editor = useEditorStore.getState()
    editor.setTool('select')
    editor.setActiveShotId(null)
    editor.selectKeyframe(null)
    editor.setAppView('editor')
    localStorage.removeItem(ACTIVE_KEY)
    useSaveStatusStore.getState().setStatus('saved')
    resetHistory()
  } finally {
    autosaveSuspended = wasAutosaveSuspended
  }
}

/** Boot saved-project discovery, then open a pristine local editor session. */
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
    // Preserve an actual pre-projects scene before replacing the live workspace.
    const legacyMetas = readLegacyMetas() ?? []
    if (legacyMetas.length > 0) {
      await loadSceneFromMetas(legacyMetas, false)
      const id = makeSceneId('proj')
      const sceneId = makeSceneId('scene')
      createdAtById.set(id, Date.now())
      useProjectStore.getState().loadProject({
        projectId: id,
        name: 'Untitled',
        workflow: createLegacyProjectWorkflow('Untitled'),
        guidelines: useAgentStore.getState().guidelines,
        savedPrompts: [],
        skills: [],
        activeSceneId: sceneId,
        sceneName: 'Scene 1',
        scenes: [{ id: sceneId, name: 'Scene 1' }],
        shots: [],
      })
      hydrateEnvironmentFromRecord({})
      localStorage.setItem(ACTIVE_KEY, id)
      await saveActiveProject()
      await refreshProjectList()
    }
  }

  useProjectStore.getState().setBooted(true)
  await initializeBlankProjectSession()
  watchForAutosave()

  // sweep buffers no scene, in any project, references anymore
  void sweepOrphanBuffers(liveBufferKeys(await getAllProjectRecords(), liveSceneMetas()))
}

/** Every buffer key referenced by any scene in any project, plus whatever the live stage holds right now. */
export function liveBufferKeys(records: ProjectRecord[], liveMetas: ObjectMeta[]): Set<string> {
  const keys = new Set<string>()
  for (const record of records) {
    record.scenes.forEach((scene) => scene.sceneMeta.forEach((m) => m.bufferKey && keys.add(m.bufferKey)))
    for (const environment of record.environments ?? []) {
      keys.add(environment.bufferKey)
      if (environment.sourceImageKey) keys.add(environment.sourceImageKey)
    }
    for (const asset of record.unplacedAssets ?? []) keys.add(asset.bufferKey)
  }
  liveMetas.forEach((m) => m.bufferKey && keys.add(m.bufferKey))
  for (const environment of useEnvironmentStore.getState().environments) {
    keys.add(environment.bufferKey)
    if (environment.sourceImageKey) keys.add(environment.sourceImageKey)
  }
  for (const asset of useEnvironmentStore.getState().unplacedAssets) keys.add(asset.bufferKey)
  return keys
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

  const records = await getAllProjectRecords()
  const record = records.find((r) => r.id === id)
  if (!record) return

  await openHydratedRecord(record)
  resetHistory()
  useSceneStore.getState().showNotice(`Switched to "${record.name}"`)
}

export function switchProject(id: string) {
  return serializeProjectTransition(() => switchProjectNow(id))
}

// ---------------------------------------------------------------------------
// Scenes — places within the active project
// ---------------------------------------------------------------------------

async function switchSceneNow(sceneId: string) {
  const { projectId, activeSceneId } = useProjectStore.getState()
  if (!projectId || sceneId === activeSceneId) return
  clearTimeout(saveTimer)
  await saveActiveProject({ createIfMissing: false })
  resetEditorChrome()

  const record = await getProjectRecord(projectId)
  const scene = record?.scenes.find((s) => s.id === sceneId)
  if (!record || !scene) return

  applyRecord({ ...record, activeSceneId: sceneId })
  await loadSceneFromMetas(scene.sceneMeta, true)
  restoreDirectorChat()
  resetHistory()
  useSceneStore.getState().showNotice(`Switched to "${scene.name}"`)
}

/** Switch which scene (place) is active within the current project. */
export function switchScene(sceneId: string) {
  return serializeProjectTransition(() => switchSceneNow(sceneId))
}

async function createSceneNow(name: string): Promise<string | null> {
  const { projectId } = useProjectStore.getState()
  if (!projectId) return null
  clearTimeout(saveTimer)
  await saveActiveProject({ createIfMissing: false })
  resetEditorChrome()

  const record = await getProjectRecord(projectId)
  if (!record) return null

  const sceneId = makeSceneId('scene')
  const emptyRig = makeEmptyRigSnapshot()
  const newScene: SceneRecord = {
    id: sceneId,
    name,
    order: record.scenes.length,
    createdAt: Date.now(),
    thumbnail: null,
    sceneMeta: [],
    rig: emptyRig,
    paths: [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
    shots: [],
    directorChat: [],
    directorLessons: [],
  }
  const updated: ProjectRecord = { ...record, activeSceneId: sceneId, scenes: [...record.scenes, newScene] }
  await idbPut(STORES.projects, updated)

  applyRecord(updated) // hydrates the rig too, via useCameraOptionsStore.loadOptions
  await loadSceneFromMetas([], true) // fresh scene with the sample shape, matches New project
  useEditorStore.getState().select(null)
  restoreDirectorChat()
  resetHistory()
  await saveActiveProject()
  await refreshProjectList()
  useSceneStore.getState().showNotice(`Scene "${name}" created`)
  return sceneId
}

/** Create a new, empty scene in the current project and switch to it. */
export function createScene(name = 'New scene') {
  return serializeProjectTransition(() => createSceneNow(name))
}

export async function renameScene(sceneId: string, name: string) {
  const next = name.trim() || 'Untitled scene'
  const store = useProjectStore.getState()
  if (store.activeSceneId === sceneId) {
    store.setSceneName(next)
    await saveActiveProject()
    return
  }
  const record = await getProjectRecord(store.projectId)
  if (!record) return
  const scenes = record.scenes.map((s) => (s.id === sceneId ? { ...s, name: next } : s))
  await idbPut(STORES.projects, { ...record, scenes, updatedAt: Date.now() })
  useProjectStore.getState().setScenes(sceneSummaries(scenes))
}

async function deleteSceneNow(sceneId: string) {
  const { projectId, activeSceneId } = useProjectStore.getState()
  if (!projectId) return
  const record = await getProjectRecord(projectId)
  // a project always keeps at least one scene
  if (!record || record.scenes.length <= 1) return
  const remaining = record.scenes.filter((s) => s.id !== sceneId)
  if (remaining.length === record.scenes.length) return

  if (activeSceneId === sceneId) {
    const updated: ProjectRecord = { ...record, scenes: remaining, activeSceneId: remaining[0].id }
    await idbPut(STORES.projects, updated)
    resetEditorChrome()
    applyRecord(updated)
    await loadSceneFromMetas(remaining[0].sceneMeta, true)
    restoreDirectorChat()
    resetHistory()
  } else {
    await idbPut(STORES.projects, { ...record, scenes: remaining, updatedAt: Date.now() })
    useProjectStore.getState().setScenes(sceneSummaries(remaining))
  }
  useSceneStore.getState().showNotice('Scene deleted')
}

/** A project always keeps at least one scene — deleting the last one is a no-op. */
export function deleteScene(sceneId: string) {
  return serializeProjectTransition(() => deleteSceneNow(sceneId))
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
  const sceneId = makeSceneId('scene')
  useProjectStore.getState().loadProject({
    projectId: id,
    name,
    workflow,
    guidelines: '',
    savedPrompts: [],
    skills: [],
    activeSceneId: sceneId,
    sceneName: 'Scene 1',
    scenes: [{ id: sceneId, name: 'Scene 1' }],
    shots: [],
    folderId,
  })
  hydrateEnvironmentFromRecord({})
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
  const record = await getProjectRecord(projectId)
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
  const record = await getProjectRecord(projectId)
  if (!record) return
  await idbPut(STORES.projects, { ...record, folderId, updatedAt: Date.now() })
  await refreshProjectList()
}

export async function removeFolder(folderId: string) {
  const records = await getAllProjectRecords()
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
