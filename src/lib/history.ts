import { useRigStore } from '../state/useRigStore'
import { usePathStore } from '../state/usePathStore'
import { useSceneStore } from '../state/useSceneStore'

/** Undoable slice of the app state (playback/tooling state is excluded). */
function capture() {
  const r = useRigStore.getState()
  const p = usePathStore.getState()
  const s = useSceneStore.getState()
  return {
    rig: {
      duration: r.duration,
      ease: r.ease,
      loop: r.loop,
      lookAtMode: r.lookAtMode,
      target: r.target,
      roll: r.roll,
      fov: r.fov,
      progressKeys: r.progressKeys,
      fovKeys: r.fovKeys,
      rollKeys: r.rollKeys,
      targetKeys: r.targetKeys,
    },
    paths: {
      paths: p.paths,
      activePathId: p.activePathId,
      drawPlaneY: p.drawPlaneY,
    },
    scene: {
      bgColor: s.bgColor,
      lightIntensity: s.lightIntensity,
      objects: s.objects.map((o) => ({
        id: o.id,
        transform: o.transform,
        keys: o.keys,
        shade: o.shade,
        name: o.name,
        primitive: o.primitive,
        follow: o.follow,
      })),
    },
  }
}

type Snapshot = ReturnType<typeof capture>

const MAX_HISTORY = 60
const COMMIT_DELAY = 350

let past: Snapshot[] = []
let future: Snapshot[] = []
let current: Snapshot
let currentJson = ''
let applying = false
let suspended = false
let commitTimer: ReturnType<typeof setTimeout> | undefined

function apply(snapshot: Snapshot) {
  applying = true
  useRigStore.setState(snapshot.rig)
  usePathStore.setState(snapshot.paths)
  const { objects, ...sceneRest } = snapshot.scene
  useSceneStore.setState(sceneRest)
  useSceneStore.getState().restoreObjects(objects)
  current = snapshot
  currentJson = JSON.stringify(snapshot)
  applying = false
}

function onStoreChange() {
  if (applying || suspended) return
  // nothing user-driven changes while the animation is playing
  if (useRigStore.getState().playing) return
  clearTimeout(commitTimer)
  commitTimer = setTimeout(() => {
    const next = capture()
    const nextJson = JSON.stringify(next)
    if (nextJson === currentJson) return
    past.push(current)
    if (past.length > MAX_HISTORY) past.shift()
    future = []
    current = next
    currentJson = nextJson
  }, COMMIT_DELAY)
}

/** re-baseline the history (new project / after scene restore) */
export function resetHistory() {
  clearTimeout(commitTimer)
  current = capture()
  currentJson = JSON.stringify(current)
  past = []
  future = []
}

export function setHistorySuspended(value: boolean) {
  suspended = value
  if (!value) {
    current = capture()
    currentJson = JSON.stringify(current)
  }
}

let subscribed = false

export function initHistory() {
  resetHistory()
  if (subscribed) return
  subscribed = true
  useRigStore.subscribe(onStoreChange)
  usePathStore.subscribe(onStoreChange)
  useSceneStore.subscribe(onStoreChange)
}

export function undo() {
  clearTimeout(commitTimer)
  // flush any pending edit so it becomes the state we undo FROM
  const pending = capture()
  const pendingJson = JSON.stringify(pending)
  if (pendingJson !== currentJson) {
    past.push(current)
    current = pending
    currentJson = pendingJson
  }
  const snapshot = past.pop()
  if (!snapshot) return false
  future.push(current)
  apply(snapshot)
  return true
}

export function redo() {
  const snapshot = future.pop()
  if (!snapshot) return false
  past.push(current)
  apply(snapshot)
  return true
}
