import { useProjectStore, type CustomSkill, type SavedPrompt, type Shot } from '../state/useProjectStore'
import { useSceneStore, makeSceneId } from '../state/useSceneStore'
import { applyRigSnapshot, getRigSnapshot, useRigStore, type RigSnapshot } from '../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore, type MotionPath } from '../state/usePathStore'
import { useEditorStore } from '../state/useEditorStore'
import { useAgentStore } from '../state/useAgentStore'
import {
  getCameraOptionsSnapshot,
  makeEmptyRigSnapshot,
  useCameraOptionsStore,
  type CameraOption,
} from '../state/useCameraOptionsStore'
import { idbDelete, idbGetAll, idbPut, STORES } from './idb'
import { syncActiveProjectToCloud } from './cloud/sync'
import { liveSceneMetas, loadSceneFromMetas, readLegacyMetas, sweepOrphanBuffers, type ObjectMeta } from './sceneIO'
import { resetHistory, setHistorySuspended } from './history'
import { renderBridge } from './renderBridge'
import { captureShotStill } from './recorder'
import {
  createLegacyProjectWorkflow,
  createProjectWorkflow,
  isProjectEditorReady,
  migrateProjectWorkflow,
  type ProjectWorkflow,
} from './projectWorkflow'

const ACTIVE_KEY = 'rig-active-project'

interface ProjectRecord {
  id: string
  name: string
  createdAt: number
  /** last save; optional for records written before the Projects screen showed it */
  updatedAt?: number
  cloudProjectId?: string
  workflow?: ProjectWorkflow
  guidelines: string
  savedPrompts: SavedPrompt[]
  skills: CustomSkill[]
  shots: Shot[]
  sceneMeta: ObjectMeta[]
  rig: RigSnapshot
  /** full motion-path collection (incl. the camera path); optional for back-compat */
  paths?: MotionPath[]
  /** named camera alternatives; optional for projects created before multi-camera support */
  cameraOptions?: CameraOption[]
  activeCameraOptionId?: string
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
    sceneMeta: liveSceneMetas(),
    rig: getRigSnapshot(),
    paths: JSON.parse(JSON.stringify(usePathStore.getState().paths)),
    cameraOptions: getCameraOptionsSnapshot(),
    activeCameraOptionId: useCameraOptionsStore.getState().activeOptionId,
  }
}

const createdAtById = new Map<string, number>()

/** Persists the active project (debounced by watchers, immediate on switch). */
export async function saveActiveProject() {
  const { projectId } = useProjectStore.getState()
  if (!projectId) return
  const createdAt = createdAtById.get(projectId) ?? Date.now()
  createdAtById.set(projectId, createdAt)
  await idbPut(STORES.projects, buildActiveRecord(projectId, createdAt))
  void syncActiveProjectToCloud().catch((error) => console.error('Cloud sync failed', error))
}

async function refreshProjectList() {
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
        shotCount: shots.length,
        updatedAt: record.updatedAt ?? record.createdAt,
        thumbnail: [...shots].sort((a, b) => a.order - b.order)[0]?.thumbnail ?? undefined,
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
  })
  // restore the whole path collection first, then let the rig snapshot
  // upsert the camera path (keeps old records without `paths` working)
  usePathStore.setState({
    paths: record.paths?.length
      ? JSON.parse(JSON.stringify(record.paths))
      : [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
    activePathId: CAMERA_PATH_ID,
    selectedAnchorId: null,
    selectedHandle: 'none',
  })
  useCameraOptionsStore
    .getState()
    .loadOptions(record.cameraOptions, record.activeCameraOptionId, record.rig)
  localStorage.setItem(ACTIVE_KEY, record.id)
}

let watching = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
let autosaveSuspended = false

function watchForAutosave() {
  if (watching) return
  watching = true
  const schedule = () => {
    if (autosaveSuspended) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void saveActiveProject().catch((error) => console.error('Failed to autosave project', error))
    }, 800)
  }
  useSceneStore.subscribe(schedule)
  useRigStore.subscribe((s) => {
    if (!s.playing) schedule() // playback t updates are not worth writes
  })
  usePathStore.subscribe(schedule) // path geometry lives here now
  useCameraOptionsStore.subscribe(schedule)
  useProjectStore.subscribe(schedule)
}

/** Boot: load the active project, or migrate the pre-projects world into one. */
export async function bootProjects() {
  const records = await refreshProjectList()

  if (records.length === 0) {
    // first run (or migration from v0.1): adopt whatever local state exists
    const legacyMetas = readLegacyMetas() ?? []
    await loadSceneFromMetas(legacyMetas, true)
    const id = makeSceneId('proj')
    createdAtById.set(id, Date.now())
    const hasLegacyWork =
      legacyMetas.length > 0 ||
      Boolean(useAgentStore.getState().guidelines.trim()) ||
      getRigSnapshot().anchors.length > 0
    useProjectStore.getState().loadProject({
      projectId: id,
      name: 'Untitled',
      workflow: hasLegacyWork
        ? createLegacyProjectWorkflow('Untitled')
        : createProjectWorkflow('Untitled'),
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
    applyRecord(record)
    await loadSceneFromMetas(record.sceneMeta, true)
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
  await saveActiveProject()

  const records = await idbGetAll<ProjectRecord>(STORES.projects)
  const record = records.find((r) => r.id === id)
  if (!record) return

  const editor = useEditorStore.getState()
  editor.select(null)
  editor.setPlayMode(false)
  editor.setCameraView(false)
  useRigStore.getState().setPlaying(false)

  applyRecord(record)
  await loadSceneFromMetas(record.sceneMeta, true)
  useAgentStore.getState().clearChat()
  resetHistory()
  useSceneStore.getState().showNotice(`Switched to "${record.name}"`)
}

export function switchProject(id: string) {
  return serializeProjectTransition(() => switchProjectNow(id))
}

async function createProjectNow(name: string, saveCurrent: boolean) {
  clearTimeout(saveTimer)
  if (saveCurrent) await saveActiveProject()

  const id = makeSceneId('proj')
  createdAtById.set(id, Date.now())
  useProjectStore.getState().loadProject({
    projectId: id,
    name,
    workflow: createProjectWorkflow(name),
    guidelines: '',
    savedPrompts: [],
    skills: [],
    shots: [],
  })
  localStorage.setItem(ACTIVE_KEY, id)
  await loadSceneFromMetas([], true) // fresh scene with the sample shape
  const emptyRig = makeEmptyRigSnapshot()
  applyRigSnapshot(emptyRig)
  useCameraOptionsStore.getState().loadOptions(undefined, undefined, emptyRig)
  useEditorStore.getState().select(null)
  useAgentStore.getState().clearChat()
  resetHistory()
  await saveActiveProject()
  await refreshProjectList()
  useSceneStore.getState().showNotice(`Project "${name}" created`)
  return id
}

export function createProject(name = 'New project') {
  return serializeProjectTransition(() => createProjectNow(name, true))
}

async function deleteProjectNow(id: string) {
  clearTimeout(saveTimer)
  await idbDelete(STORES.projects, id)
  createdAtById.delete(id)
  const records = await refreshProjectList()
  if (useProjectStore.getState().projectId === id) {
    if (records.length > 0) {
      applyRecord(records[0])
      await loadSceneFromMetas(records[0].sceneMeta, true)
      useAgentStore.getState().clearChat()
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
    name: `Shot ${(project.shots.length + 1) * 10}`,
    order: project.shots.length,
    rig: getRigSnapshot(),
    format: { aspect: editor.exportAspect, res: editor.exportRes, custom: editor.customSize },
    duration: useRigStore.getState().duration,
    // the clean cinema frame; falls back to the viewport grab if the render
    // bridge is not ready yet
    thumbnail: (await captureShotStill()) ?? (await captureThumbnail()),
  }
  project.addShot(shot)
  useSceneStore.getState().showNotice(`"${shot.name}" saved — open the Board to see it`)
}

export function loadShot(shot: Shot) {
  useCameraOptionsStore.getState().createOption(shot.name, shot.rig)
  const editor = useEditorStore.getState()
  editor.setExportAspect(shot.format.aspect)
  editor.setExportRes(shot.format.res)
  editor.setCustomSize(shot.format.custom)
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
