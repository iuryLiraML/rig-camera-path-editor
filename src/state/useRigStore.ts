import { create } from 'zustand'
import type { Vec3 } from './useSceneStore'
import { KEY_MERGE_EPS, type ProgressKey, type ValueKey, type Vec3Key } from '../lib/keyframes'
import { clamp01 } from '../lib/intervalSpacing'

function stripSpacing<K extends { easeIn?: number; easeOut?: number }>(key: K): K {
  const next = { ...key }
  delete next.easeIn
  delete next.easeOut
  return next
}
import {
  DEFAULT_CAMERA_NOISE,
  normalizeCameraNoise,
  styleAmps,
  type CameraNoise,
} from '../lib/cameraNoise'
import { DEFAULT_EASE, easeForSmoothness, type EaseKind } from '../lib/easing'
import { CAMERA_PATH_ID, makeAnchor, usePathStore, type MotionPath, type PathAnchor } from './usePathStore'
import type { PathSpace } from '../lib/pathSpace'

export type { PathAnchor } from './usePathStore'
export type LookAtMode = 'target' | 'path-tangent' | 'free'

/** A camera either rides a path or sits at one manually-posed spot. */
export type CameraKind = 'path' | 'static'

/** Explicit pose of a static (pathless) camera. Rotation is XYZ Euler degrees. */
export interface StaticPose {
  position: Vec3
  rotation: Vec3
}

export const DEFAULT_STATIC_POSE: StaticPose = { position: [4, 2, 6], rotation: [0, 0, 0] }

/** animatable camera channels */
export type ScalarChannel =
  | 'fov'
  | 'roll'
  | 'intensity'
  | 'fadeIn'
  | 'fadeOut'
  | 'ampPos'
  | 'ampRot'
  | 'freq'
export type RigChannel = ScalarChannel | 'target' | 'lookOffset' | 'progress'

const CHANNEL_FIELD = {
  fov: 'fovKeys',
  roll: 'rollKeys',
  intensity: 'intensityKeys',
  fadeIn: 'fadeInKeys',
  fadeOut: 'fadeOutKeys',
  ampPos: 'ampPosKeys',
  ampRot: 'ampRotKeys',
  freq: 'freqKeys',
  target: 'targetKeys',
  lookOffset: 'lookOffsetKeys',
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

function readVec3(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value) || value.length < 3) return fallback
  if (typeof value[0] !== 'number' || typeof value[1] !== 'number' || typeof value[2] !== 'number') {
    return fallback
  }
  return [value[0], value[1], value[2]]
}

function readStaticPose(value: unknown): StaticPose {
  const d = (value ?? {}) as Record<string, unknown>
  return {
    position: readVec3(d.position, DEFAULT_STATIC_POSE.position),
    rotation: readVec3(d.rotation, DEFAULT_STATIC_POSE.rotation),
  }
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
  /**
   * Which path in the collection this camera follows. Absent on snapshots written
   * before the camera referenced a path — those carry only the inline geometry
   * below, which `applyRigSnapshot` materializes into the camera path.
   */
  pathId?: string
  progressKeys: ProgressKey[]
  fovKeys?: ValueKey[]
  rollKeys?: ValueKey[]
  intensityKeys?: ValueKey[]
  fadeInKeys?: ValueKey[]
  fadeOutKeys?: ValueKey[]
  ampPosKeys?: ValueKey[]
  ampRotKeys?: ValueKey[]
  freqKeys?: ValueKey[]
  targetKeys?: Vec3Key[]
  lookOffset?: Vec3
  lookOffsetKeys?: Vec3Key[]
  cameraNoise?: CameraNoise
  /** Scene object the look-at target follows; null = fixed / keyed XYZ */
  targetObjectId?: string | null
  /** When `object`, camera path anchors are in the tracked object's local space */
  pathSpace?: PathSpace
  /** `static` = manually-posed camera with no path (uses `staticPose`) */
  cameraKind?: CameraKind
  /** pose used when `cameraKind` is `static` */
  staticPose?: StaticPose
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
  intensityKeys: ValueKey[]
  fadeInKeys: ValueKey[]
  fadeOutKeys: ValueKey[]
  ampPosKeys: ValueKey[]
  ampRotKeys: ValueKey[]
  freqKeys: ValueKey[]
  targetKeys: Vec3Key[]
  lookOffset: Vec3
  lookOffsetKeys: Vec3Key[]
  cameraNoise: CameraNoise
  targetObjectId: string | null
  pathSpace: PathSpace
  cameraKind: CameraKind
  staticPose: StaticPose
  setCameraNoise: (patch: Partial<CameraNoise>) => void
  setTargetObjectId: (id: string | null) => void
  setPathSpace: (space: PathSpace) => void
  setCameraKind: (kind: CameraKind) => void
  setStaticPose: (patch: Partial<StaticPose>) => void

  upsertProgressKey: (time: number, progress: number) => void
  updateProgressKeyTime: (id: string, time: number) => void
  removeProgressKey: (id: string) => void
  clearProgressKeys: () => void
  upsertChannelKey: (channel: ScalarChannel, time: number, value: number) => void
  upsertTargetKey: (time: number, value: Vec3) => void
  upsertLookOffsetKey: (time: number, value: Vec3) => void
  removeChannelKey: (channel: RigChannel, id: string) => void
  updateChannelKeyTime: (channel: RigChannel, id: string, time: number) => void
  setKeyValue: (channel: RigChannel, id: string, value: number) => void
  setKeyEase: (channel: RigChannel, id: string, ease: EaseKind) => void
  setKeyBezier: (
    channel: RigChannel,
    id: string,
    bezier: [number, number, number, number] | null,
  ) => void
  setKeySpacing: (
    channel: RigChannel,
    id: string,
    patch: { easeIn?: number; easeOut?: number },
    linked?: boolean,
  ) => void
  clearKeySpacing: (channel: RigChannel, id: string) => void
  clearAllSpacing: () => void
  clearChannel: (channel: RigChannel) => void
  /** point the camera at another path in the collection (shared reference) */
  setCameraPath: (pathId: string) => void
  setEase: (ease: EaseKind) => void
  setDuration: (seconds: number) => void
  /** legacy entry point: the agent tool, camera generators and old files */
  setSmoothness: (s: number) => void
  setLoop: (loop: boolean) => void
  setLookAtMode: (mode: LookAtMode) => void
  setTarget: (target: Vec3) => void
  setLookOffset: (offset: Vec3) => void
  setRoll: (deg: number) => void
  setFov: (fov: number) => void
  setPlaying: (playing: boolean) => void
  setT: (t: number) => void
  exportJSON: () => string
  importJSON: (json: string) => boolean
}

export const useRigStore = create<RigState>()((set, get) => ({
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
      intensityKeys: [] as ValueKey[],
      fadeInKeys: [] as ValueKey[],
      fadeOutKeys: [] as ValueKey[],
      ampPosKeys: [] as ValueKey[],
      ampRotKeys: [] as ValueKey[],
      freqKeys: [] as ValueKey[],
      targetKeys: [] as Vec3Key[],
      lookOffset: [0, 0, 0] as Vec3,
      lookOffsetKeys: [] as Vec3Key[],
      cameraNoise: { ...DEFAULT_CAMERA_NOISE },
      targetObjectId: null as string | null,
      pathSpace: 'world' as PathSpace,
      cameraKind: 'path' as CameraKind,
      staticPose: { ...DEFAULT_STATIC_POSE },
      setCameraNoise: (patch) =>
        set((s) => {
          const next = { ...s.cameraNoise, ...patch }
          if (
            patch.style &&
            patch.ampPos === undefined &&
            patch.ampRot === undefined &&
            patch.freq === undefined
          ) {
            Object.assign(next, styleAmps(patch.style))
          }
          return { cameraNoise: next }
        }),

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

      upsertLookOffsetKey: (time, value) =>
        set((s) => {
          const existing = s.lookOffsetKeys.find((k) => Math.abs(k.time - time) < KEY_MERGE_EPS)
          return {
            lookOffsetKeys: existing
              ? s.lookOffsetKeys.map((k) => (k.id === existing.id ? { ...k, value } : k))
              : [...s.lookOffsetKeys, { id: makeKeyId('lookOffset', time), time, value }],
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

      setKeyValue: (channel, id, value) =>
        set((s) => {
          const field = CHANNEL_FIELD[channel]
          if (channel === 'progress') {
            return {
              progressKeys: s.progressKeys.map((k) =>
                k.id === id ? { ...k, progress: clamp01(value) } : k,
              ),
            }
          }
          if (channel === 'target' || channel === 'lookOffset') {
            const keys = s[field] as Vec3Key[]
            return {
              [field]: keys.map((k) =>
                k.id === id ? { ...k, value: [k.value[0], value, k.value[2]] as Vec3 } : k,
              ),
            } as unknown as Partial<RigState>
          }
          const keys = s[field] as ValueKey[]
          return {
            [field]: keys.map((k) => (k.id === id ? { ...k, value } : k)),
          } as unknown as Partial<RigState>
        }),

      setKeyEase: (channel, id, ease) =>
        set((s) => {
          const field = CHANNEL_FIELD[channel]
          const keys = s[field] as { id: string; easeBezier?: [number, number, number, number] }[]
          return {
            [field]: keys.map((k) => {
              if (k.id !== id) return k
              const next = { ...k, ease }
              delete next.easeBezier
              return next
            }),
          } as unknown as Partial<RigState>
        }),

      setKeyBezier: (channel, id, bezier) =>
        set((s) => {
          const field = CHANNEL_FIELD[channel]
          const keys = s[field] as { id: string; easeBezier?: [number, number, number, number] }[]
          return {
            [field]: keys.map((k) => {
              if (k.id !== id) return k
              const next = { ...k }
              if (bezier) next.easeBezier = bezier
              else delete next.easeBezier
              return next
            }),
          } as unknown as Partial<RigState>
        }),

      setKeySpacing: (channel, id, patch, linked = false) =>
        set((s) => {
          const field = CHANNEL_FIELD[channel]
          const keys = s[field] as { id: string; easeIn?: number; easeOut?: number }[]
          return {
            [field]: keys.map((k) => {
              if (k.id !== id) return k
              const next = { ...k }
              if (patch.easeOut !== undefined) {
                next.easeOut = clamp01(patch.easeOut)
                if (linked) next.easeIn = next.easeOut
              }
              if (patch.easeIn !== undefined) {
                next.easeIn = clamp01(patch.easeIn)
                if (linked) next.easeOut = next.easeIn
              }
              return next
            }),
          } as unknown as Partial<RigState>
        }),

      clearKeySpacing: (channel, id) =>
        set((s) => {
          const field = CHANNEL_FIELD[channel]
          const keys = s[field] as { id: string; easeIn?: number; easeOut?: number }[]
          return {
            [field]: keys.map((k) => (k.id === id ? stripSpacing(k) : k)),
          } as unknown as Partial<RigState>
        }),

      clearAllSpacing: () =>
        set((s) => ({
          progressKeys: s.progressKeys.map(stripSpacing),
          fovKeys: s.fovKeys.map(stripSpacing),
          rollKeys: s.rollKeys.map(stripSpacing),
          intensityKeys: s.intensityKeys.map(stripSpacing),
          fadeInKeys: s.fadeInKeys.map(stripSpacing),
          fadeOutKeys: s.fadeOutKeys.map(stripSpacing),
          ampPosKeys: s.ampPosKeys.map(stripSpacing),
          ampRotKeys: s.ampRotKeys.map(stripSpacing),
          freqKeys: s.freqKeys.map(stripSpacing),
          targetKeys: s.targetKeys.map(stripSpacing),
          lookOffsetKeys: s.lookOffsetKeys.map(stripSpacing),
        })),

      clearChannel: (channel) =>
        set({ [CHANNEL_FIELD[channel]]: [] } as unknown as Partial<RigState>),

      setCameraPath: (pathId) => {
        // refuse an unknown id rather than leaving the camera pointing at nothing
        if (!usePathStore.getState().paths.some((path) => path.id === pathId)) return
        set({ cameraPathId: pathId })
      },
      setEase: (ease) => set({ ease }),
      setDuration: (duration) => set({ duration: Math.min(30, Math.max(1, duration)) }),
      setSmoothness: (s) => set({ ease: easeForSmoothness(s) }),
      setLoop: (loop) => set({ loop }),
      setLookAtMode: (lookAtMode) => set({ lookAtMode }),
      setTarget: (target) => set({ target }),
      setLookOffset: (lookOffset) => set({ lookOffset }),
      setTargetObjectId: (targetObjectId) =>
        set(
          targetObjectId
            ? {
                targetObjectId,
                lookAtMode: 'target' as LookAtMode,
                pathSpace: get().pathSpace,
              }
            : {
                targetObjectId: null,
                lookAtMode: get().lookAtMode,
                pathSpace: 'world' as const,
                lookOffset: [0, 0, 0] as Vec3,
                lookOffsetKeys: [],
              },
        ),
      setPathSpace: (pathSpace) => {
        if (pathSpace === 'object' && !get().targetObjectId) return
        set({ pathSpace })
      },
      setCameraKind: (cameraKind) => set({ cameraKind }),
      setStaticPose: (patch) => set((s) => ({ staticPose: { ...s.staticPose, ...patch } })),
      setRoll: (roll) => set({ roll }),
      setFov: (fov) => set({ fov: Math.min(140, Math.max(5, fov)) }),
      setPlaying: (playing) => set({ playing }),
      setT: (t) => set({ t: Math.min(1, Math.max(0, t)) }),

      exportJSON: (): string => {
        const s = get()
        const cam = usePathStore.getState().getPath(CAMERA_PATH_ID)
        return JSON.stringify(
          {
            version: 5,
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
            intensityKeys: s.intensityKeys,
            fadeInKeys: s.fadeInKeys,
            fadeOutKeys: s.fadeOutKeys,
            ampPosKeys: s.ampPosKeys,
            ampRotKeys: s.ampRotKeys,
            freqKeys: s.freqKeys,
            targetKeys: s.targetKeys,
            lookOffset: s.lookOffset,
            lookOffsetKeys: s.lookOffsetKeys,
            cameraNoise: s.cameraNoise,
            targetObjectId: s.targetObjectId,
            pathSpace: s.pathSpace,
            cameraKind: s.cameraKind,
            staticPose: s.staticPose,
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
          usePathStore.setState({ selectedAnchorId: null, selectedAnchorIds: [], selectedHandle: 'none' })
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
            intensityKeys: Array.isArray(data.intensityKeys) ? data.intensityKeys : [],
            fadeInKeys: Array.isArray(data.fadeInKeys) ? data.fadeInKeys : [],
            fadeOutKeys: Array.isArray(data.fadeOutKeys) ? data.fadeOutKeys : [],
            ampPosKeys: Array.isArray(data.ampPosKeys) ? data.ampPosKeys : [],
            ampRotKeys: Array.isArray(data.ampRotKeys) ? data.ampRotKeys : [],
            freqKeys: Array.isArray(data.freqKeys) ? data.freqKeys : [],
            targetKeys: Array.isArray(data.targetKeys) ? data.targetKeys : [],
            lookOffset: readVec3(data.lookOffset, [0, 0, 0]),
            lookOffsetKeys: Array.isArray(data.lookOffsetKeys) ? data.lookOffsetKeys : [],
            cameraNoise: normalizeCameraNoise(data.cameraNoise),
            targetObjectId: typeof data.targetObjectId === 'string' ? data.targetObjectId : null,
            pathSpace: data.pathSpace === 'object' ? 'object' : 'world',
            cameraKind: data.cameraKind === 'static' ? 'static' : 'path',
            staticPose: readStaticPose(data.staticPose),
            playing: false,
            t: 0,
          })
          return true
        } catch {
          return false
        }
      },
}))

/**
 * The live rig used to persist to localStorage (`rig-camera-settings`) in
 * parallel with the per-project IndexedDB record. Both hydrated async on
 * reload, so whichever finished last won — typically the global persist
 * with `cameraNoise.enabled: false`, which hid the FX tracks. The project
 * snapshot is the only source of truth now.
 */
try {
  localStorage.removeItem('rig-camera-settings')
} catch {
  /* node / private mode */
}

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
      pathId: s.cameraPathId,
      progressKeys: s.progressKeys,
      fovKeys: s.fovKeys,
      rollKeys: s.rollKeys,
      intensityKeys: s.intensityKeys,
      fadeInKeys: s.fadeInKeys,
      fadeOutKeys: s.fadeOutKeys,
      ampPosKeys: s.ampPosKeys,
      ampRotKeys: s.ampRotKeys,
      freqKeys: s.freqKeys,
      targetKeys: s.targetKeys,
      lookOffset: s.lookOffset,
      lookOffsetKeys: s.lookOffsetKeys,
      cameraNoise: s.cameraNoise,
      targetObjectId: s.targetObjectId,
      pathSpace: s.pathSpace,
      cameraKind: s.cameraKind,
      staticPose: s.staticPose,
    }),
  )
}

export function applyRigSnapshot(snapshot: RigSnapshot) {
  const snap = JSON.parse(JSON.stringify(snapshot)) as RigSnapshot

  /*
   * Switching cameras used to overwrite the single camera-path slot with the
   * snapshot's inline geometry, which is why two cameras could never share a
   * route. If the snapshot names a path that still exists, just point at it and
   * leave every path alone. Only a snapshot with no live path — an older project,
   * an imported JSON, a Board shot from elsewhere — gets its bundled geometry
   * materialized, and that goes into the camera path as before.
   */
  const live = usePathStore.getState().paths
  const referenced = snap.pathId && live.some((path) => path.id === snap.pathId)
  const targetPathId = referenced ? (snap.pathId as string) : CAMERA_PATH_ID

  if (!referenced) {
    usePathStore.getState().setPathData(CAMERA_PATH_ID, {
      name: 'Camera Path',
      anchors: snap.anchors ?? [],
      closed: snap.closed ?? false,
      rounding: snap.rounding ?? 0.8,
    })
  }

  usePathStore.setState({
    activePathId: targetPathId,
    selectedAnchorId: null,
    selectedAnchorIds: [],
    selectedHandle: 'none',
    drawPlaneY: snap.drawPlaneY ?? 1.2,
  })
  useRigStore.setState({
    cameraPathId: targetPathId,
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
    intensityKeys: snap.intensityKeys ?? [],
    fadeInKeys: snap.fadeInKeys ?? [],
    fadeOutKeys: snap.fadeOutKeys ?? [],
    ampPosKeys: snap.ampPosKeys ?? [],
    ampRotKeys: snap.ampRotKeys ?? [],
    freqKeys: snap.freqKeys ?? [],
    targetKeys: snap.targetKeys ?? [],
    lookOffset: readVec3(snap.lookOffset, [0, 0, 0]),
    lookOffsetKeys: snap.lookOffsetKeys ?? [],
    cameraNoise: normalizeCameraNoise(snap.cameraNoise),
    targetObjectId: snap.targetObjectId ?? null,
    pathSpace: snap.pathSpace === 'object' ? 'object' : 'world',
    cameraKind: snap.cameraKind === 'static' ? 'static' : 'path',
    staticPose: readStaticPose(snap.staticPose),
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
