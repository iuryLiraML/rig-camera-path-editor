import { useProjectStore, type CustomSkill, type SavedPrompt, type Shot } from '../state/useProjectStore'
import { useSceneStore, makeSceneId } from '../state/useSceneStore'
import { applyRigSnapshot, getRigSnapshot, useRigStore, type RigSnapshot } from '../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore, type MotionPath } from '../state/usePathStore'
import { useEditorStore } from '../state/useEditorStore'
import { useAgentStore } from '../state/useAgentStore'
import { idbDelete, idbGetAll, idbPut, STORES } from './idb'
import { liveSceneMetas, loadSceneFromMetas, readLegacyMetas, sweepOrphanBuffers, type ObjectMeta } from './sceneIO'
import { resetHistory } from './history'
import { renderBridge } from './renderBridge'

const ACTIVE_KEY = 'rig-active-project'

interface ProjectRecord {
  id: string
  name: string
  createdAt: number
  guidelines: string
  savedPrompts: SavedPrompt[]
  skills: CustomSkill[]
  shots: Shot[]
  sceneMeta: ObjectMeta[]
  rig: RigSnapshot
  /** full motion-path collection (incl. the camera path); optional for back-compat */
  paths?: MotionPath[]
}

function buildActiveRecord(id: string, createdAt: number): ProjectRecord {
  const project = useProjectStore.getState()
  return {
    id,
    name: project.name,
    createdAt,
    guidelines: project.guidelines,
    savedPrompts: project.savedPrompts,
    skills: project.skills,
    shots: project.shots,
    sceneMeta: liveSceneMetas(),
    rig: getRigSnapshot(),
    paths: JSON.parse(JSON.stringify(usePathStore.getState().paths)),
  }
}

const createdAtById = new Map<string, number>()

/** Persists the active project (debounced by watchers, immediate on switch). */
export async function saveActiveProject() {
  const { projectId } = useProjectStore.getState()
  if (!projectId) return
  const createdAt = createdAtById.get(projectId) ?? Date.now()
  createdAtById.set(projectId, createdAt)
  try {
    await idbPut(STORES.projects, buildActiveRecord(projectId, createdAt))
  } catch (e) {
    console.error('Failed to save project', e)
  }
}

async function refreshProjectList() {
  const records = await idbGetAll<ProjectRecord>(STORES.projects)
  records.sort((a, b) => a.createdAt - b.createdAt)
  records.forEach((r) => createdAtById.set(r.id, r.createdAt))
  useProjectStore.getState().setProjectList(records.map((r) => ({ id: r.id, name: r.name })))
  return records
}

function applyRecord(record: ProjectRecord) {
  useProjectStore.getState().loadProject({
    projectId: record.id,
    name: record.name,
    guidelines: record.guidelines,
    savedPrompts: record.savedPrompts ?? [],
    skills: record.skills ?? [],
    shots: record.shots ?? [],
  })
  // restore the whole path collection first, then let the rig snapshot
  // upsert the camera path (keeps old records without `paths` working)
  if (record.paths?.length) {
    usePathStore.setState({
      paths: JSON.parse(JSON.stringify(record.paths)),
      activePathId: CAMERA_PATH_ID,
      selectedAnchorId: null,
      selectedHandle: 'none',
    })
  }
  applyRigSnapshot(record.rig)
  localStorage.setItem(ACTIVE_KEY, record.id)
}

let watching = false
let saveTimer: ReturnType<typeof setTimeout> | undefined

function watchForAutosave() {
  if (watching) return
  watching = true
  const schedule = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void saveActiveProject(), 800)
  }
  useSceneStore.subscribe(schedule)
  useRigStore.subscribe((s) => {
    if (!s.playing) schedule() // playback t updates are not worth writes
  })
  usePathStore.subscribe(schedule) // path geometry lives here now
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
    useProjectStore.getState().loadProject({
      projectId: id,
      name: 'Untitled',
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

  // sweep buffers no project references anymore
  const live = new Set<string>()
  for (const r of await idbGetAll<ProjectRecord>(STORES.projects)) {
    r.sceneMeta.forEach((m) => m.bufferKey && live.add(m.bufferKey))
  }
  liveSceneMetas().forEach((m) => m.bufferKey && live.add(m.bufferKey))
  void sweepOrphanBuffers(live)
}

export async function switchProject(id: string) {
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

export async function createProject(name = 'New project') {
  clearTimeout(saveTimer)
  await saveActiveProject()

  const id = makeSceneId('proj')
  createdAtById.set(id, Date.now())
  useProjectStore.getState().loadProject({
    projectId: id,
    name,
    guidelines: '',
    savedPrompts: [],
    skills: [],
    shots: [],
  })
  localStorage.setItem(ACTIVE_KEY, id)
  await loadSceneFromMetas([], true) // fresh scene with the sample shape
  applyRigSnapshot({
    anchors: [],
    closed: false,
    drawPlaneY: 1.2,
    duration: 6,
    smoothness: 0.6,
    rounding: 0.8,
    loop: true,
    lookAtMode: 'target',
    target: [0, 1, 0],
    roll: 0,
    fov: 45,
    progressKeys: [],
  })
  useEditorStore.getState().select(null)
  useAgentStore.getState().clearChat()
  resetHistory()
  await saveActiveProject()
  await refreshProjectList()
  useSceneStore.getState().showNotice(`Project "${name}" created`)
}

export async function deleteProject(id: string) {
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
      await createProject('Untitled')
    }
  }
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
    thumbnail: await captureThumbnail(),
  }
  project.addShot(shot)
  useSceneStore.getState().showNotice(`"${shot.name}" saved — open the Board to see it`)
}

export function loadShot(shot: Shot) {
  applyRigSnapshot(shot.rig)
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
  const editor = useEditorStore.getState()
  editor.setAppView('editor')
  editor.select(null)
  editor.setPlayMode(true)

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

  useEditorStore.getState().setPlayMode(false)
  useRigStore.getState().setPlaying(false)
  applyRigSnapshot(previousRig)
}
