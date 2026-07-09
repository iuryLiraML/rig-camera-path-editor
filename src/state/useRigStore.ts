import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Vec3 } from './useSceneStore'
import { KEY_MERGE_EPS, type ProgressKey } from '../lib/keyframes'
import { CAMERA_PATH_ID, makeAnchor, usePathStore, type MotionPath, type PathAnchor } from './usePathStore'

export type { PathAnchor } from './usePathStore'
export type LookAtMode = 'target' | 'path-tangent'

/** serializable camera rig — self-contained (bundles the camera path geometry) */
export interface RigSnapshot {
  anchors: PathAnchor[]
  closed: boolean
  drawPlaneY: number
  duration: number
  smoothness: number
  rounding: number
  loop: boolean
  lookAtMode: LookAtMode
  target: Vec3
  roll: number
  fov: number
  progressKeys: ProgressKey[]
}

interface RigState {
  /** the path the cinema camera follows (always CAMERA_PATH_ID) */
  cameraPathId: string
  duration: number
  /** 0 = constant speed, 1 = smooth start/stop */
  smoothness: number
  loop: boolean
  lookAtMode: LookAtMode
  target: Vec3
  roll: number
  fov: number
  playing: boolean
  t: number
  /** camera keyframes: pin the path-position at a moment in time */
  progressKeys: ProgressKey[]

  upsertProgressKey: (time: number, progress: number) => void
  updateProgressKeyTime: (id: string, time: number) => void
  removeProgressKey: (id: string) => void
  clearProgressKeys: () => void
  setDuration: (seconds: number) => void
  setSmoothness: (s: number) => void
  setLoop: (loop: boolean) => void
  setLookAtMode: (mode: LookAtMode) => void
  setTarget: (target: Vec3) => void
  setRoll: (deg: number) => void
  setFov: (fov: number) => void
  setPlaying: (playing: boolean) => void
  setT: (t: number) => void
  exportJSON: () => string
  importJSON: (json: string) => boolean
}

export const useRigStore = create<RigState>()(
  persist(
    (set, get) => ({
      cameraPathId: CAMERA_PATH_ID,
      duration: 6,
      smoothness: 0.6,
      loop: true,
      lookAtMode: 'target' as LookAtMode,
      target: [0, 1, 0] as Vec3,
      roll: 0,
      fov: 45,
      playing: false,
      t: 0,
      progressKeys: [] as ProgressKey[],

      upsertProgressKey: (time, progress) =>
        set((s) => {
          const existing = s.progressKeys.find((k) => Math.abs(k.time - time) < KEY_MERGE_EPS)
          if (existing) {
            return { progressKeys: s.progressKeys.map((k) => (k.id === existing.id ? { ...k, progress } : k)) }
          }
          return { progressKeys: [...s.progressKeys, { id: `pk-${Date.now().toString(36)}-${Math.round(progress * 1e4)}`, time, progress }] }
        }),

      updateProgressKeyTime: (id, time) =>
        set((s) => ({
          progressKeys: s.progressKeys.map((k) => (k.id === id ? { ...k, time: Math.min(1, Math.max(0, time)) } : k)),
        })),

      removeProgressKey: (id) => set((s) => ({ progressKeys: s.progressKeys.filter((k) => k.id !== id) })),
      clearProgressKeys: () => set({ progressKeys: [] }),

      setDuration: (duration) => set({ duration: Math.min(30, Math.max(1, duration)) }),
      setSmoothness: (s) => set({ smoothness: Math.min(1, Math.max(0, s)) }),
      setLoop: (loop) => set({ loop }),
      setLookAtMode: (lookAtMode) => set({ lookAtMode }),
      setTarget: (target) => set({ target }),
      setRoll: (roll) => set({ roll }),
      setFov: (fov) => set({ fov: Math.min(140, Math.max(5, fov)) }),
      setPlaying: (playing) => set({ playing }),
      setT: (t) => set({ t: Math.min(1, Math.max(0, t)) }),

      exportJSON: (): string => {
        const s = get()
        const cam = usePathStore.getState().getPath(CAMERA_PATH_ID)
        return JSON.stringify(
          {
            version: 4,
            anchors: cam?.anchors ?? [],
            closed: cam?.closed ?? false,
            rounding: cam?.rounding ?? 0.8,
            duration: s.duration,
            smoothness: s.smoothness,
            loop: s.loop,
            lookAtMode: s.lookAtMode,
            target: s.target,
            roll: s.roll,
            fov: s.fov,
            progressKeys: s.progressKeys,
          },
          null,
          2,
        )
      },

      importJSON: (json: string) => {
        try {
          const data = JSON.parse(json)
          if (!Array.isArray(data.anchors)) return false
          const legacySmoothness = data.easing === 'linear' ? 0 : data.easing === 'easeInOut' ? 0.9 : 0.5
          usePathStore.getState().setPathData(CAMERA_PATH_ID, {
            name: 'Camera Path',
            anchors: data.anchors.map((a: PathAnchor) => ({ ...makeAnchor(a.position), ...a, manual: a.manual ?? true })),
            closed: !!data.closed,
            rounding: typeof data.rounding === 'number' ? data.rounding : 0.8,
          })
          usePathStore.setState({ selectedAnchorId: null, selectedHandle: 'none' })
          set({
            duration: typeof data.duration === 'number' ? data.duration : 6,
            smoothness: typeof data.smoothness === 'number' ? data.smoothness : legacySmoothness,
            loop: data.loop ?? true,
            lookAtMode: data.lookAtMode ?? 'target',
            target: data.target ?? [0, 1, 0],
            roll: data.roll ?? 0,
            fov: data.fov ?? 45,
            progressKeys: Array.isArray(data.progressKeys) ? data.progressKeys : [],
            playing: false,
            t: 0,
          })
          return true
        } catch {
          return false
        }
      },
    }),
    {
      name: 'rig-camera-settings',
      partialize: (s) => ({
        duration: s.duration,
        smoothness: s.smoothness,
        loop: s.loop,
        lookAtMode: s.lookAtMode,
        target: s.target,
        roll: s.roll,
        fov: s.fov,
        progressKeys: s.progressKeys,
      }),
    },
  ),
)

/** camera rig snapshot — bundles the camera path so shots/JSON stay self-contained */
export function getRigSnapshot(): RigSnapshot {
  const s = useRigStore.getState()
  const cam = usePathStore.getState().getPath(CAMERA_PATH_ID)
  return JSON.parse(
    JSON.stringify({
      anchors: cam?.anchors ?? [],
      closed: cam?.closed ?? false,
      drawPlaneY: usePathStore.getState().drawPlaneY,
      duration: s.duration,
      smoothness: s.smoothness,
      rounding: cam?.rounding ?? 0.8,
      loop: s.loop,
      lookAtMode: s.lookAtMode,
      target: s.target,
      roll: s.roll,
      fov: s.fov,
      progressKeys: s.progressKeys,
    }),
  )
}

export function applyRigSnapshot(snapshot: RigSnapshot) {
  const snap = JSON.parse(JSON.stringify(snapshot)) as RigSnapshot
  usePathStore.getState().setPathData(CAMERA_PATH_ID, {
    name: 'Camera Path',
    anchors: snap.anchors ?? [],
    closed: snap.closed ?? false,
    rounding: snap.rounding ?? 0.8,
  })
  usePathStore.setState({
    activePathId: CAMERA_PATH_ID,
    selectedAnchorId: null,
    selectedHandle: 'none',
    drawPlaneY: snap.drawPlaneY ?? 1.2,
  })
  useRigStore.setState({
    duration: snap.duration,
    smoothness: snap.smoothness,
    loop: snap.loop,
    lookAtMode: snap.lookAtMode,
    target: snap.target,
    roll: snap.roll,
    fov: snap.fov,
    progressKeys: snap.progressKeys ?? [],
    playing: false,
    t: 0,
  })
}

export function downloadRigJSON() {
  const blob = new Blob([useRigStore.getState().exportJSON()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'camera-rig.json'
  a.click()
  URL.revokeObjectURL(url)
}

export function openRigImportDialog(onDone: (ok: boolean) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const text = await file.text()
    onDone(useRigStore.getState().importJSON(text))
  }
  input.click()
}

export type { MotionPath }
