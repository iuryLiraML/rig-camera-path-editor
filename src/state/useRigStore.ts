import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Vec3 } from './useSceneStore'
import { KEY_MERGE_EPS, type ProgressKey, type ValueKey, type Vec3Key } from '../lib/keyframes'
import { DEFAULT_EASE, easeForSmoothness, type EaseKind } from '../lib/easing'
import { CAMERA_PATH_ID, makeAnchor, usePathStore, type MotionPath, type PathAnchor } from './usePathStore'

export type { PathAnchor } from './usePathStore'
export type LookAtMode = 'target' | 'path-tangent'

/** animatable camera channels */
export type ScalarChannel = 'fov' | 'roll'
export type RigChannel = ScalarChannel | 'target' | 'progress'

const CHANNEL_FIELD = {
  fov: 'fovKeys',
  roll: 'rollKeys',
  target: 'targetKeys',
  progress: 'progressKeys',
} as const

let keySeq = 0
const makeKeyId = (channel: string, time: number) =>
  `${channel}-${Math.round(time * 1e4)}-${keySeq++}`

/** rough inverse of easeForSmoothness, so a snapshot stays readable by old builds */
function smoothnessForEase(ease: EaseKind): number {
  if (ease === 'linear') return 0
  if (ease.endsWith('InOut')) return ease.startsWith('sine') ? 0.3 : 0.75
  return 0.6
}

/** the curve a saved file or persisted state describes, however old it is */
function readEase(data: unknown): EaseKind {
  const d = (data ?? {}) as Record<string, unknown>
  if (typeof d.ease === 'string') return d.ease as EaseKind
  if (typeof d.smoothness === 'number') return easeForSmoothness(d.smoothness)
  if (d.easing === 'linear') return 'linear'
  if (d.easing === 'easeInOut') return 'quintInOut'
  return DEFAULT_EASE
}

/** serializable camera rig — self-contained (bundles the camera path geometry) */
export interface RigSnapshot {
  anchors: PathAnchor[]
  closed: boolean
  drawPlaneY: number
  duration: number
  /** legacy 0..1 smoothness, still written so an older build can read a shot */
  smoothness: number
  /** the default animation curve (supersedes smoothness) */
  ease?: EaseKind
  rounding: number
  loop: boolean
  lookAtMode: LookAtMode
  target: Vec3
  roll: number
  fov: number
  progressKeys: ProgressKey[]
  fovKeys?: ValueKey[]
  rollKeys?: ValueKey[]
  targetKeys?: Vec3Key[]
}

interface RigState {
  /** the path the cinema camera follows (always CAMERA_PATH_ID) */
  cameraPathId: string
  duration: number
  /**
   * Default animation curve for every channel; a keyframe can override it for
   * the segment it starts. Replaces the old 0..1 smoothness slider, so there is
   * one easing language rather than two.
   */
  ease: EaseKind
  loop: boolean
  lookAtMode: LookAtMode
  target: Vec3
  roll: number
  fov: number
  playing: boolean
  t: number
  /** camera keyframes: pin the path-position at a moment in time */
  progressKeys: ProgressKey[]
  /** animated lens + framing channels; empty means "use the static value" */
  fovKeys: ValueKey[]
  rollKeys: ValueKey[]
  targetKeys: Vec3Key[]

  upsertProgressKey: (time: number, progress: number) => void
  updateProgressKeyTime: (id: string, time: number) => void
  removeProgressKey: (id: string) => void
  clearProgressKeys: () => void
  upsertChannelKey: (channel: ScalarChannel, time: number, value: number) => void
  upsertTargetKey: (time: number, value: Vec3) => void
  removeChannelKey: (channel: RigChannel, id: string) => void
  updateChannelKeyTime: (channel: RigChannel, id: string, time: number) => void
  setKeyEase: (channel: RigChannel, id: string, ease: EaseKind) => void
  clearChannel: (channel: RigChannel) => void
  setEase: (ease: EaseKind) => void
  setDuration: (seconds: number) => void
  /** legacy entry point: the agent tool, camera generators and old files */
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
      ease: DEFAULT_EASE as EaseKind,
      loop: true,
      lookAtMode: 'target' as LookAtMode,
      target: [0, 1, 0] as Vec3,
      roll: 0,
      fov: 45,
      playing: false,
      t: 0,
      progressKeys: [] as ProgressKey[],
      fovKeys: [] as ValueKey[],
      rollKeys: [] as ValueKey[],
      targetKeys: [] as Vec3Key[],

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

      upsertChannelKey: (channel, time, value) =>
        set((s) => {
          const field = CHANNEL_FIELD[channel]
          const keys = s[field] as ValueKey[]
          const existing = keys.find((k) => Math.abs(k.time - time) < KEY_MERGE_EPS)
          return {
            [field]: existing
              ? keys.map((k) => (k.id === existing.id ? { ...k, value } : k))
              : [...keys, { id: makeKeyId(channel, time), time, value }],
          } as unknown as Partial<RigState>
        }),

      upsertTargetKey: (time, value) =>
        set((s) => {
          const existing = s.targetKeys.find((k) => Math.abs(k.time - time) < KEY_MERGE_EPS)
          return {
            targetKeys: existing
              ? s.targetKeys.map((k) => (k.id === existing.id ? { ...k, value } : k))
              : [...s.targetKeys, { id: makeKeyId('target', time), time, value }],
          }
        }),

      removeChannelKey: (channel, id) =>
        set((s) => {
          const field = CHANNEL_FIELD[channel]
          const keys = s[field] as { id: string }[]
          return { [field]: keys.filter((k) => k.id !== id) } as unknown as Partial<RigState>
        }),

      updateChannelKeyTime: (channel, id, time) =>
        set((s) => {
          const field = CHANNEL_FIELD[channel]
          const keys = s[field] as { id: string; time: number }[]
          return {
            [field]: keys.map((k) =>
              k.id === id ? { ...k, time: Math.min(1, Math.max(0, time)) } : k,
            ),
          } as unknown as Partial<RigState>
        }),

      setKeyEase: (channel, id, ease) =>
        set((s) => {
          const field = CHANNEL_FIELD[channel]
          const keys = s[field] as { id: string }[]
          return {
            [field]: keys.map((k) => (k.id === id ? { ...k, ease } : k)),
          } as unknown as Partial<RigState>
        }),

      clearChannel: (channel) =>
        set({ [CHANNEL_FIELD[channel]]: [] } as unknown as Partial<RigState>),

      setEase: (ease) => set({ ease }),
      setDuration: (duration) => set({ duration: Math.min(30, Math.max(1, duration)) }),
      setSmoothness: (s) => set({ ease: easeForSmoothness(s) }),
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
            ease: s.ease,
            loop: s.loop,
            lookAtMode: s.lookAtMode,
            target: s.target,
            roll: s.roll,
            fov: s.fov,
            progressKeys: s.progressKeys,
            fovKeys: s.fovKeys,
            rollKeys: s.rollKeys,
            targetKeys: s.targetKeys,
          },
          null,
          2,
        )
      },

      importJSON: (json: string) => {
        try {
          const data = JSON.parse(json)
          if (!Array.isArray(data.anchors)) return false
          usePathStore.getState().setPathData(CAMERA_PATH_ID, {
            name: 'Camera Path',
            anchors: data.anchors.map((a: PathAnchor) => ({ ...makeAnchor(a.position), ...a, manual: a.manual ?? true })),
            closed: !!data.closed,
            rounding: typeof data.rounding === 'number' ? data.rounding : 0.8,
          })
          usePathStore.setState({ selectedAnchorId: null, selectedHandle: 'none' })
          set({
            duration: typeof data.duration === 'number' ? data.duration : 6,
            ease: readEase(data),
            loop: data.loop ?? true,
            lookAtMode: data.lookAtMode ?? 'target',
            target: data.target ?? [0, 1, 0],
            roll: data.roll ?? 0,
            fov: data.fov ?? 45,
            progressKeys: Array.isArray(data.progressKeys) ? data.progressKeys : [],
            fovKeys: Array.isArray(data.fovKeys) ? data.fovKeys : [],
            rollKeys: Array.isArray(data.rollKeys) ? data.rollKeys : [],
            targetKeys: Array.isArray(data.targetKeys) ? data.targetKeys : [],
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
      version: 2,
      // persisted state predates the curve presets: map its smoothness across
      migrate: (persisted: unknown, version: number) => {
        const state = (persisted ?? {}) as Record<string, unknown>
        if (version < 2) state.ease = readEase(state)
        return state as never
      },
      partialize: (s) => ({
        duration: s.duration,
        ease: s.ease,
        loop: s.loop,
        lookAtMode: s.lookAtMode,
        target: s.target,
        roll: s.roll,
        fov: s.fov,
        progressKeys: s.progressKeys,
        fovKeys: s.fovKeys,
        rollKeys: s.rollKeys,
        targetKeys: s.targetKeys,
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
      smoothness: smoothnessForEase(s.ease),
      ease: s.ease,
      rounding: cam?.rounding ?? 0.8,
      loop: s.loop,
      lookAtMode: s.lookAtMode,
      target: s.target,
      roll: s.roll,
      fov: s.fov,
      progressKeys: s.progressKeys,
      fovKeys: s.fovKeys,
      rollKeys: s.rollKeys,
      targetKeys: s.targetKeys,
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
    ease: readEase(snap),
    loop: snap.loop,
    lookAtMode: snap.lookAtMode,
    target: snap.target,
    roll: snap.roll,
    fov: snap.fov,
    progressKeys: snap.progressKeys ?? [],
    fovKeys: snap.fovKeys ?? [],
    rollKeys: snap.rollKeys ?? [],
    targetKeys: snap.targetKeys ?? [],
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
