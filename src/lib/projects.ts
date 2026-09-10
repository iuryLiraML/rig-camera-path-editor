import { useProjectStore, type CustomSkill, type DirectorChatEntry, type SavedPrompt, type Shot, type ProjectSummary } from '../state/useProjectStore'
import { useSceneStore, makeSceneId } from '../state/useSceneStore'
import { applyRigSnapshot, getRigSnapshot, useRigStore, type RigSnapshot } from '../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore, type MotionPath } from '../state/usePathStore'
import { cameraAnchorCount } from '../state/cameraPathLink'
import { useEditorStore } from '../state/useEditorStore'
import { useAgentStore } from '../state/useAgentStore'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import {
  getCameraOptionsSnapshot,
  makeEmptyRigSnapshot,
  useCameraOptionsStore,
  type CameraOption,
} from '../state/useCameraOptionsStore'
import { idbGet, idbGetAll, idbPut, idbUpdate, STORES } from './idb'
import { CloudConflictError, isTeamCloudApp, listCloudProjects } from './cloud/client'
import { deleteSyncedProject, hydrateCloudProject, syncActiveProjectToCloud, syncProjectToCloud } from './cloud/sync'
import { liveSceneMetas, loadSceneFromMetas, readLegacyMetas, sweepOrphanBuffers, type ObjectMeta } from './sceneIO'
import { hydrateEnvironmentFromRecord, loadLiveEnvironmentBuffer } from './environmentJobs'
import type { ProjectEnvironment, ProjectMeshAsset } from './environment'
import { cloneEnvTransform } from './environment'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { resetHistory, setHistorySuspended } from './history'
import { renderBridge } from './renderBridge'
import { captureShotStill } from './recorder'
import {
  createLegacyProjectWorkflow,
  isProjectEditorReady,
  migrateProjectWorkflow,
  type ProjectWorkflow,
} from './projectWorkflow'
import { deleteFolder as deleteFolderRecord, listFolders } from './folders'
import { setPersistFlusher } from './persistFlush'
import { useSaveStatusStore } from './saveStatus'
import { libraryBufferKeys, listLibraryAssets, listLibraryCollections } from './library'
import { createProductionList, reconcileProductionList } from './productionWorkflow'
import type { ProductionBreakdown } from './agent/productionBreakdown'
import type { ProductionList } from './productionWorkflow'

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
  contentRevision?: string
  cloudSyncedRevision?: string
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
  contentRevision?: string
  cloudSyncedRevision?: string
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


function restoreDirectorChat() {
  useAgentStore.getState().clearChat()
  useAgentStore.getState().hydrateDirectorChat()
}

/**
 * Assigns an id to the live editor session without wiping the scene — unlike
 * "New project", which starts from an empty rig. Used when autosave/unload
 * runs before the user has ever named a project.
 */
function ensureActiveProjectId(createIfMissing: boolean): string | null {
  const current = useProjectStore.getState()
  if (current.projectId) return current.projectId
  const view = useEditorStore.getState().appView
  if (!createIfMissing || view === 'projects' || view === 'home' || view === 'library') return null
  const id = makeSceneId('proj')
  const activeSceneId = current.activeSceneId || makeSceneId('scene')
  const sceneName = current.sceneName.trim() || 'Scene 1'
  // Identity assignment is bookkeeping; it must not create another authored edit.
  const suspended = autosaveSuspended
  autosaveSuspended = true
  try {
    useProjectStore.setState({
      projectId: id,
      activeSceneId,
      sceneName,
      scenes: current.scenes.length ? current.scenes : [{ id: activeSceneId, name: sceneName }],
    })
  } finally {
    autosaveSuspended = suspended
  }
  createdAtById.set(id, Date.now())
  localStorage.setItem(ACTIVE_KEY, id)
  return id
}

const localSaves = new Map<string, Promise<void>>()
const deletingProjects = new Set<string>()
let authoredRevision = 0

/** Editor snapshots and Projects card actions share the same per-project write order. */
function enqueueProjectWrite<T>(projectId: string, write: () => Promise<T>): Promise<T> {
  const pending = (localSaves.get(projectId) ?? Promise.resolve()).catch(() => {}).then(write)
  const settled = pending.then(() => {}, () => {})
  localSaves.set(projectId, settled)
  void settled.then(() => {
    if (localSaves.get(projectId) === settled) localSaves.delete(projectId)
  })
  return pending
}

function requestProjectSync(projectId: string) {
  if (isCloudFirst()) useSaveStatusStore.getState().setCloudStatus(projectId, 'pending')
  void syncProjectToCloud(projectId).catch((error) => {
    if (error instanceof CloudConflictError) {
      useCloudAuthStore.getState().setSaveConflict({ projectId, updatedAt: error.updatedAt })
    }
    console.error('Cloud sync failed', error)
  })
}

/** Persist an authored mutation against the latest record, keeping cloud acknowledgements intact. */
function editProjectRecord(projectId: string, edit: (record: ProjectRecord) => ProjectRecord) {
  return enqueueProjectWrite(projectId, async () => {
    let changed = false
    const updated = await idbUpdate<ProjectRecord>(STORES.projects, projectId, (current) => {
      const record = normalizeProjectRecord(current)
      const next = edit(record)
      if (next === record) return current
      changed = true
      return { ...next, contentRevision: crypto.randomUUID(), updatedAt: Date.now() }
    })
    if (updated && changed) {
      upsertProjectSummary(updated)
      requestProjectSync(projectId)
    }
    return updated
  })
}

/** Apply an asynchronous production result to its owning project, even after navigation. */
export async function updateProjectProduction(projectId: string, edit: (list: ProductionList) => ProductionList) {
  if (deletingProjects.has(projectId)) return
  const current = useProjectStore.getState()
  if (current.projectId === projectId) {
    current.setProduction(edit(current.workflow.production))
    await saveActiveProject({ createIfMissing: false })
  } else {
    await editProjectRecord(projectId, (record) => {
      const workflow = migrateProjectWorkflow(record.workflow, record.name)
      return { ...record, workflow: { ...workflow, production: edit(workflow.production) } }
    })
  }
}

/** Capture before any await, then serialize writes for this project in invocation order. */
export async function saveActiveProject(options?: { createIfMissing?: boolean }) {
  const projectId = ensureActiveProjectId(options?.createIfMissing ?? true)
  if (projectId && deletingProjects.has(projectId)) return
  if (!projectId) {
    useSaveStatusStore.getState().setStatus('saved')
    return
  }
  clearTimeout(saveTimer)
  const revision = authoredRevision
  const createdAt = createdAtById.get(projectId) ?? Date.now()
  const snapshot = structuredClone(buildActiveRecord(projectId, createdAt))
  const contentRevision = crypto.randomUUID()
  const isCurrent = () => useProjectStore.getState().projectId === projectId
    && useProjectStore.getState().activeSceneId === snapshot.activeSceneId
    && authoredRevision === revision
  useSaveStatusStore.getState().setStatus('saving')
  const pending = enqueueProjectWrite(projectId, async () => {
    const previous = await getProjectRecord(projectId)
    const scene = snapshot.scenes[0]
    const mergeScene = (stored: SceneRecord[]) => stored.some((s) => s.id === scene.id)
      ? stored.map((s) => s.id === scene.id ? { ...scene, order: s.order, createdAt: s.createdAt, thumbnail: s.thumbnail } : s)
      : [...stored, { ...scene, order: stored.length }]
    const scenes = mergeScene(previous?.scenes ?? [])
    let record: ProjectRecord = {
      ...snapshot,
      createdAt: previous?.createdAt ?? createdAt,
      scenes,
      contentRevision,
      cloudSyncedRevision: previous?.cloudSyncedRevision,
      cloudProjectId: previous?.cloudProjectId,
      cloudUpdatedAt: previous?.cloudUpdatedAt,
      bufferAssets: previous?.bufferAssets,
      stillAssets: previous?.stillAssets,
    }
    if (previous) {
      const updated = await idbUpdate<ProjectRecord>(STORES.projects, projectId, (latest) => ({
        ...record, scenes: mergeScene(normalizeProjectRecord(latest).scenes), cloudProjectId: latest.cloudProjectId, cloudUpdatedAt: latest.cloudUpdatedAt,
        cloudSyncedRevision: latest.cloudSyncedRevision, bufferAssets: latest.bufferAssets, stillAssets: latest.stillAssets,
      }))
      if (!updated) return
      record = updated
    } else {
      await idbPut(STORES.projects, record)
    }
    upsertProjectSummary(record)
    if (isCurrent()) useSaveStatusStore.getState().setStatus('saved')
    requestProjectSync(projectId)
  })
  try {
    await pending
  } catch (error) {
    if (isCurrent()) useSaveStatusStore.getState().setStatus('dirty')
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

function projectSummary(record: ProjectRecord): ProjectSummary {
  const scenes = [...record.scenes].sort((a, b) => a.order - b.order)
  const shots = scenes.flatMap((s) => s.shots ?? [])
  return {
    id: record.id,
    name: record.name,
    setupStatus: isProjectEditorReady(migrateProjectWorkflow(record.workflow, record.name)) ? 'ready' : 'draft',
    folderId: record.folderId ?? null,
    shotCount: shots.length,
    objectCount: scenes.reduce((n, s) => n + s.sceneMeta.length, 0),
    pathCount: scenes.reduce((n, s) => n + (s.paths ?? []).filter((p) => p.anchors.length > 0).length, 0),
    updatedAt: record.updatedAt ?? record.createdAt,
    thumbnail: scenes[0]?.thumbnail ?? [...shots].sort((a, b) => a.order - b.order)[0]?.thumbnail ?? undefined,
    scenes: sceneSummaries(scenes),
  }
}

function upsertProjectSummary(record: ProjectRecord) {
  const current = useProjectStore.getState().projectList
  useProjectStore.getState().setProjectList(
    [...current.filter((p) => p.id !== record.id), projectSummary(record)].sort((a, b) => b.updatedAt - a.updatedAt),
  )
}

async function refreshProjectList() {
  await refreshFolderList()
  const records = await getAllProjectRecords()
  records.forEach((r) => createdAtById.set(r.id, r.createdAt))
  const summaries = new Map(records.map((record) => [record.id, projectSummary(record)]))
  if (isCloudFirst()) {
    const accessToken = useCloudAuthStore.getState().accessToken
    if (accessToken) {
      const cloud = await listCloudProjects(accessToken).catch((error) => {
        console.error('Cloud project discovery failed', error)
        return []
      })
      for (const project of cloud) {
        const local = records.find((r) => (r.cloudProjectId ?? r.id) === project.id)
        if (local) continue
        const scenes = scenesFromUnknownEditorState(project.editorState)
        summaries.set(project.id, {
          id: project.id, name: project.name, folderId: null,
          setupStatus: isProjectEditorReady(migrateProjectWorkflow(project.workflow, project.name)) ? 'ready' : 'draft',
          shotCount: shotCountFromUnknownEditorState(project.editorState),
          updatedAt: Date.parse(project.updatedAt) || Date.now(),
          scenes: scenes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((s) => ({ id: s.id, name: s.name })),
        })
      }
    }
  }
  useProjectStore.getState().setProjectList([...summaries.values()].sort((a, b) => b.updatedAt - a.updatedAt))
  return records.sort((a, b) => a.createdAt - b.createdAt)
}

/** Replace a Scene's paths, including transient anchor selection, before restoring its cameras. */
function restoreScenePaths(paths?: MotionPath[], drawPlaneY = 1.2) {
  usePathStore.setState({
    paths: paths?.length
      ? JSON.parse(JSON.stringify(paths))
      : [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
    activePathId: CAMERA_PATH_ID,
    selectedAnchorRefs: [],
    primaryAnchorRef: null,
    selectedAnchorId: null,
    selectedAnchorIds: [],
    selectedHandle: 'none',
    drawPlaneY,
  })
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
  restoreScenePaths(scene.paths, scene.rig.drawPlaneY)
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
  authoredRevision += 1
  useSaveStatusStore.getState().setStatus('dirty')
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void saveActiveProject({ createIfMissing: true }).catch((error) => console.error('Failed to autosave project', error))
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
  useSceneStore.subscribe((s, before) => {
    if (s.objects !== before.objects) scheduleAutosave()
  })
  useRigStore.subscribe((s, before) => {
    // Time, playback and selection never affect the persisted rig.
    const { t: _t, playing: _playing, ...content } = s
    const { t: _oldT, playing: _oldPlaying, ...oldContent } = before
    if (Object.keys(content).some((key) => content[key as keyof typeof content] !== oldContent[key as keyof typeof content])) scheduleAutosave()
  })
  usePathStore.subscribe((s, before) => {
    if (s.paths !== before.paths || s.drawPlaneY !== before.drawPlaneY) scheduleAutosave()
  })
  useCameraOptionsStore.subscribe((s, before) => {
    if (s.options !== before.options || s.activeOptionId !== before.activeOptionId) scheduleAutosave()
  })
  useProjectStore.subscribe((s, before) => {
    const keys = ['name', 'workflow', 'guidelines', 'savedPrompts', 'skills', 'sceneName', 'shots', 'directorChat', 'directorLessons', 'folderId'] as const
    if (keys.some((key) => s[key] !== before[key])) scheduleAutosave()
  })
  useEnvironmentStore.subscribe((s, before) => {
    const keys = ['environments', 'unplacedAssets', 'environmentId', 'environmentTransform'] as const
    if (keys.some((key) => s[key] !== before[key])) scheduleAutosave()
  })
}

async function openHydratedRecord(record: ProjectRecord) {
  const suspended = autosaveSuspended
  autosaveSuspended = true
  try {
    applyRecord(record)
    await loadSceneFromMetas(activeSceneOf(record).sceneMeta, true)
    restoreDirectorChat()
  } finally {
    autosaveSuspended = suspended
    clearTimeout(saveTimer)
  }
}

async function loadCloudRecord(projectId: string, force = false): Promise<ProjectRecord> {
  const local = await getProjectRecord(projectId)
  if (!force && local && (!local.cloudProjectId || local.contentRevision !== local.cloudSyncedRevision)) {
    void syncProjectToCloud(projectId).catch((error) => console.error('Cloud retry failed', error))
    return local
  }
  const hydrated = await hydrateCloudProject(local?.cloudProjectId ?? projectId)
  const revision = force ? crypto.randomUUID() : local?.contentRevision
  const record = { ...hydrated, id: projectId, contentRevision: revision, cloudSyncedRevision: revision }
  createdAtById.set(record.id, record.createdAt)
  await idbPut(STORES.projects, record)
  upsertProjectSummary(record)
  useSaveStatusStore.getState().setCloudStatus(projectId, 'saved')
  return record
}

export async function reloadActiveProjectFromCloud(projectId = useProjectStore.getState().projectId) {
  if (!projectId) return
  await localSaves.get(projectId)
  const record = await loadCloudRecord(projectId, true)
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
    restoreScenePaths(undefined, emptyRig.drawPlaneY)
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

/** Leave a draft through the same persistence boundary as project switching. */
export function openBlankProjectSession(signal?: AbortSignal) {
  return serializeProjectTransition(async () => {
    if (signal?.aborted) return
    await flushActiveProject({ createIfMissing: useSaveStatusStore.getState().status === 'dirty' })
    if (!signal?.aborted) await initializeBlankProjectSession()
  })
}

/** Boot saved-project discovery, then open a pristine local editor session. */
export async function bootProjects() {
  if (isTeamCloudApp() && !isCloudFirst()) {
    useProjectStore.getState().setProjectList([])
    useProjectStore.setState({ projectId: '' })
    useEditorStore.getState().setAppView('home')
    watchForAutosave()
    useProjectStore.getState().setBooted(true)
    return
  }

  if (isCloudFirst()) {
    await refreshProjectList()
    useProjectStore.setState({ projectId: '' })
    await initializeBlankProjectSession()
    useEditorStore.getState().setAppView('home')
    await listLibraryAssets().catch(() => undefined)
    await listLibraryCollections().catch(() => undefined)
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
  useEditorStore.getState().setAppView('home')
  watchForAutosave()
  await listLibraryAssets().catch(() => undefined)
  await listLibraryCollections().catch(() => undefined)

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
  for (const key of libraryBufferKeys()) keys.add(key)
  return keys
}

let projectTransition = Promise.resolve()
let pendingProjectTransitions = 0

function serializeProjectTransition<T>(operation: () => Promise<T>): Promise<T> {
  const hydrate = async () => {
    const suspended = autosaveSuspended
    autosaveSuspended = true
    try { return await operation() }
    finally { autosaveSuspended = suspended; clearTimeout(saveTimer) }
  }
  const run = projectTransition.then(hydrate, hydrate)
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

async function switchProjectNow(id: string, signal?: AbortSignal) {
  if (signal?.aborted) return
  const { projectId } = useProjectStore.getState()
  if (id === projectId) return
  clearTimeout(saveTimer)
  await saveActiveProject({ createIfMissing: useSaveStatusStore.getState().status === 'dirty' })
  await localSaves.get(id)
  resetEditorChrome()

  if (isCloudFirst()) {
    const record = await loadCloudRecord(id)
    if (signal?.aborted) return
    await openHydratedRecord(record)
    resetHistory()
    useSceneStore.getState().showNotice(`Switched to "${record.name}"`)
    return
  }

  const records = await getAllProjectRecords()
  const record = records.find((r) => r.id === id)
  if (!record || signal?.aborted) return

  await openHydratedRecord(record)
  resetHistory()
  useSceneStore.getState().showNotice(`Switched to "${record.name}"`)
}

export function switchProject(id: string, signal?: AbortSignal) {
  return serializeProjectTransition(() => switchProjectNow(id, signal))
}

// ---------------------------------------------------------------------------
// Scenes — places within the active project
// ---------------------------------------------------------------------------

async function switchSceneNow(sceneId: string, signal?: AbortSignal) {
  if (signal?.aborted) return
  const { projectId, activeSceneId } = useProjectStore.getState()
  if (!projectId || sceneId === activeSceneId) return
  clearTimeout(saveTimer)
  await saveActiveProject({ createIfMissing: useSaveStatusStore.getState().status === 'dirty' })
  resetEditorChrome()

  const record = await getProjectRecord(projectId)
  const scene = record?.scenes.find((s) => s.id === sceneId)
  if (!record || !scene || signal?.aborted) return

  applyRecord({ ...record, activeSceneId: sceneId })
  await loadSceneFromMetas(scene.sceneMeta, true)
  restoreDirectorChat()
  resetHistory()
  useSceneStore.getState().showNotice(`Switched to "${scene.name}"`)
}

/** Switch which scene (place) is active within the current project. */
export function switchScene(sceneId: string, signal?: AbortSignal) {
  return serializeProjectTransition(() => switchSceneNow(sceneId, signal))
}

async function createSceneNow(name: string): Promise<string | null> {
  const { projectId } = useProjectStore.getState()
  if (!projectId) return null
  clearTimeout(saveTimer)
  await saveActiveProject({ createIfMissing: useSaveStatusStore.getState().status === 'dirty' })
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
  const updated = await editProjectRecord(projectId, (current) => ({
    ...current, activeSceneId: sceneId, scenes: [...current.scenes, { ...newScene, order: current.scenes.length }],
  }))
  if (!updated) return null

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

export async function renameScene(sceneId: string, name: string, projectId?: string) {
  const next = name.trim() || 'Untitled scene'
  const store = useProjectStore.getState()
  const targetProjectId = projectId ?? store.projectId
  const isActiveProject = Boolean(targetProjectId) && store.projectId === targetProjectId

  if (isActiveProject && store.activeSceneId === sceneId) {
    store.setSceneName(next)
    await saveActiveProject()
    await refreshProjectList()
    return
  }
  const updated = await editProjectRecord(targetProjectId, (record) => ({
    ...record, scenes: record.scenes.map((s) => s.id === sceneId ? { ...s, name: next } : s),
  }))
  if (updated && useProjectStore.getState().projectId === targetProjectId) {
    useProjectStore.getState().setScenes(sceneSummaries(updated.scenes))
  }
  await refreshProjectList()
}

async function deleteSceneNow(sceneId: string) {
  const { projectId, activeSceneId } = useProjectStore.getState()
  if (!projectId) return
  await saveActiveProject({ createIfMissing: false })
  const updated = await editProjectRecord(projectId, (record) => {
    const remaining = record.scenes.filter((s) => s.id !== sceneId)
    // A stale card or a concurrent deletion must never remove the last scene.
    if (!remaining.length || remaining.length === record.scenes.length) return record
    return { ...record, scenes: remaining, activeSceneId: record.activeSceneId === sceneId ? remaining[0].id : record.activeSceneId }
  })
  if (!updated || updated.scenes.some((s) => s.id === sceneId)) return

  if (activeSceneId === sceneId) {
    resetEditorChrome()
    applyRecord(updated)
    await loadSceneFromMetas(activeSceneOf(updated).sceneMeta, true)
    restoreDirectorChat()
    resetHistory()
  } else {
    useProjectStore.getState().setScenes(sceneSummaries(updated.scenes))
  }
  useSceneStore.getState().showNotice('Scene deleted')
}

/** A project always keeps at least one scene — deleting the last one is a no-op. */
export function deleteScene(sceneId: string) {
  return serializeProjectTransition(() => deleteSceneNow(sceneId))
}

async function createProjectNow(name: string, saveCurrent: boolean, folderId: string | null = null) {
  clearTimeout(saveTimer)
  if (saveCurrent) await saveActiveProject({ createIfMissing: useSaveStatusStore.getState().status === 'dirty' })

  const id = makeSceneId('proj')
  const workflow = createLegacyProjectWorkflow(name)
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
  restoreScenePaths(undefined, emptyRig.drawPlaneY)
  applyRigSnapshot(emptyRig)
  useCameraOptionsStore.getState().loadOptions(undefined, undefined, emptyRig)
  useEditorStore.getState().select(null)
  restoreDirectorChat()
  resetHistory()
  await saveActiveProject()
  await refreshProjectList()
  useSceneStore.getState().showNotice(`Project "${name}" created`)
  return id
}

export function createProject(name = 'New project', folderId: string | null = null) {
  return serializeProjectTransition(() => createProjectNow(name, true, folderId))
}

/** Commit the reviewed intake as one complete project; analysis itself never creates records. */
export function createGuidedProject(draft: ProductionBreakdown, source: string, folderId: string | null = null) {
  const input = structuredClone(draft)
  return serializeProjectTransition(async () => {
    if (!input.proposal.scenes.length || input.proposal.scenes.some((scene) => !scene.name.trim())) {
      throw new Error('Name at least one scene before creating the project.')
    }
    await saveActiveProject({ createIfMissing: useSaveStatusStore.getState().status === 'dirty' })
    const id = makeSceneId('proj')
    const now = Date.now()
    const production = reconcileProductionList(createProductionList(), input.proposal).list
    const workflow = createLegacyProjectWorkflow(input.name)
    workflow.production = production
    workflow.briefSource = { ...workflow.briefSource, status: 'ready', contentType: 'text/plain', extractedText: source, parsedAt: new Date(now).toISOString() }
    const skillId = `production-guidelines-${crypto.randomUUID()}`
    workflow.guidelines = { status: 'approved', draft: input.guidelines, skillBody: input.guidelines, skillName: 'Project production guidelines', skillId, approvedAt: new Date(now).toISOString() }
    const scenes: SceneRecord[] = production.scenes.map((scene, order) => ({
      id: scene.id, name: scene.name, order, createdAt: now,
      sceneMeta: [], rig: makeEmptyRigSnapshot(),
      paths: [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
      shots: [], directorChat: [], directorLessons: [],
    }))
    const record: ProjectRecord = {
      id, name: input.name.trim() || 'New project', createdAt: now, updatedAt: now,
      contentRevision: crypto.randomUUID(), folderId, workflow,
      guidelines: input.guidelines, savedPrompts: [],
      skills: [{ id: skillId, name: 'Project production guidelines', description: 'Approved visual direction for production assets.', body: input.guidelines }],
      activeSceneId: scenes[0].id, scenes,
    }
    await enqueueProjectWrite(id, () => idbPut(STORES.projects, record))
    createdAtById.set(id, now)
    upsertProjectSummary(record)
    resetEditorChrome()
    await openHydratedRecord(record)
    localStorage.setItem(ACTIVE_KEY, id)
    resetHistory()
    useSaveStatusStore.getState().setStatus('saved')
    requestProjectSync(id)
    return id
  })
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
  await editProjectRecord(projectId, (record) => ({ ...record, name: next }))
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
  await editProjectRecord(projectId, (record) => ({ ...record, folderId }))
  await refreshProjectList()
}

export async function removeFolder(folderId: string) {
  const records = await getAllProjectRecords()
  await Promise.all(
    records
      .filter((record) => record.folderId === folderId)
      .map((record) => editProjectRecord(record.id, (current) => ({ ...current, folderId: null }))),
  )
  const store = useProjectStore.getState()
  if (store.folderId === folderId) store.setFolderId(null)
  await deleteFolderRecord(folderId)
  await refreshProjectList()
}

export { createFolder, renameFolder, listFolders } from './folders'
export type { FolderRecord } from './folders'

async function deleteProjectNow(id: string, localOnly = false) {
  clearTimeout(saveTimer)
  deletingProjects.add(id)
  try {
    const activeId = useProjectStore.getState().projectId
    if (activeId !== id && useSaveStatusStore.getState().status === 'dirty') {
      await saveActiveProject({ createIfMissing: true })
    }
    await enqueueProjectWrite(id, () => deleteSyncedProject(id, { localOnly }))
    createdAtById.delete(id)
    if (useProjectStore.getState().projectId === id) {
      // Do not use save-before-switch navigation after deleting its source.
      await initializeBlankProjectSession()
      useEditorStore.getState().setAppView('home')
    }
    await refreshProjectList()
  } finally {
    deletingProjects.delete(id)
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
  if (cameraAnchorCount() < 2) {
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
  useSceneStore.getState().showNotice(`"${shot.name}" saved — it is in Storyboard`)
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
  applyShot(shot)
  const editor = useEditorStore.getState()
  editor.setAppView('editor')
  editor.select('camera-path')
  useSceneStore.getState().showNotice(`"${shot.name}" loaded`)
}

export function duplicateShotAsCameraOption(shot: Shot) {
  const id = useCameraOptionsStore.getState().createOption(shot.name, shot.rig)
  applyShot(shot)
  useEditorStore.getState().select('cinema-camera')
  useSceneStore.getState().showNotice(`"${shot.name}" duplicated as a camera option`)
  return id
}

export async function leaveEditorTo(
  view: 'home' | 'library' | 'projects',
  signal?: AbortSignal,
) {
  try {
    if (signal?.aborted) return false
    await flushActiveProject({ createIfMissing: useSaveStatusStore.getState().status === 'dirty' })
    if (signal?.aborted) return false
    if (useSaveStatusStore.getState().status === 'dirty') {
      useSceneStore.getState().showNotice('Could not save. Stay in the editor and try again.')
      return false
    }
    const { projectId, activeSceneId } = useProjectStore.getState()
    if (projectId && useSceneStore.getState().objects.length > 0) {
      const thumbnail = await captureThumbnail().catch(() => null)
      if (thumbnail) {
        const updated = await idbUpdate<ProjectRecord>(STORES.projects, projectId, (record) => ({
          ...record, scenes: record.scenes.map((s) => s.id === activeSceneId ? { ...s, thumbnail } : s),
        }))
        if (updated) upsertProjectSummary(updated)
      }
    }
    // Local persistence already upserts summaries; discover other tabs without requiring cloud availability.
    const records = await getAllProjectRecords()
    for (const record of records) upsertProjectSummary(record)
    if (signal?.aborted) return false
    useEditorStore.getState().setAppView(view)
    return true
  } catch (error) {
    useSceneStore.getState().showNotice(
      error instanceof Error ? error.message : 'Could not save. Stay in the editor and try again.',
    )
    return false
  }
}

export async function goHome(signal?: AbortSignal) {
  return leaveEditorTo('home', signal)
}

export async function goLibrary(signal?: AbortSignal) {
  return leaveEditorTo('library', signal)
}

export async function goProjects(signal?: AbortSignal) {
  return leaveEditorTo('projects', signal)
}

export async function listUnsyncedProjects(): Promise<{ id: string; name: string }[]> {
  if (!isCloudFirst()) return []
  const records = await idbGetAll<ProjectRecord>(STORES.projects)
  return records
    .filter((record) => !record.cloudUpdatedAt || record.contentRevision !== record.cloudSyncedRevision)
    .map((record) => ({ id: record.id, name: record.name }))
}

export async function downloadProjectJson(id: string) {
  const record = await idbGet<ProjectRecord>(STORES.projects, id)
  if (!record) return
  const blob = new Blob([JSON.stringify(record)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${record.name.replace(/[^\w.-]+/g, '_') || 'project'}.json`
  link.click()
  URL.revokeObjectURL(url)
}

/** Flush, try to sync, then wipe — or park a no-default dialog when copies are unsynced. */
export async function beginSignOut() {
  const auth = useCloudAuthStore.getState()
  if (auth.status !== 'signed-in' || !auth.session) return
  await flushActiveProject({ createIfMissing: useSaveStatusStore.getState().status === 'dirty' })
  try {
    await syncActiveProjectToCloud()
  } catch (error) {
    console.error('Cloud sync before sign-out failed', error)
  }
  const unsynced = await listUnsyncedProjects()
  if (unsynced.length === 0) {
    await auth.signOut()
    return
  }
  useCloudAuthStore.getState().setPendingSignOut(unsynced)
}

function dropPendingSignOut(id: string) {
  const pending = useCloudAuthStore.getState().pendingSignOut
  if (!pending) return
  const next = pending.filter((project) => project.id !== id)
  if (next.length === 0) {
    void useCloudAuthStore.getState().signOut()
    return
  }
  useCloudAuthStore.getState().setPendingSignOut(next)
}

/** Upload one parked local copy, then sign out when none remain. */
export async function uploadUnsyncedProject(id: string) {
  if (useProjectStore.getState().projectId === id) {
    await flushActiveProject({ createIfMissing: false })
  }
  await syncProjectToCloud(id)
  dropPendingSignOut(id)
}

/** Download one parked local copy, then sign out when none remain. */
export async function backupUnsyncedProject(id: string) {
  await downloadProjectJson(id)
  dropPendingSignOut(id)
}

/** Discard one parked local copy, then sign out when none remain. */
export async function discardUnsyncedProject(id: string) {
  await serializeProjectTransition(() => deleteProjectNow(id, true))
  dropPendingSignOut(id)
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
