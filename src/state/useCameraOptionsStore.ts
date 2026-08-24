import { create } from 'zustand'
import { applyRigSnapshot, DEFAULT_STATIC_POSE, getRigSnapshot, type RigSnapshot } from './useRigStore'

export interface CameraOption {
  id: string
  name: string
  rig: RigSnapshot
  /** true only for the untouched placeholder created with a new project */
  pristine?: boolean
}

interface CameraOptionsState {
  options: CameraOption[]
  activeOptionId: string
  loadOptions: (options: CameraOption[] | undefined, activeId: string | undefined, fallback: RigSnapshot) => void
  captureActive: () => void
  createOption: (name?: string, rig?: RigSnapshot) => string
  switchOption: (id: string) => boolean
  renameOption: (id: string, name: string) => void
  removeOption: (id: string) => void
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
let nextCameraId = 1
const makeCameraId = () => `camera-${Date.now().toString(36)}-${nextCameraId++}`

export function makeEmptyRigSnapshot(): RigSnapshot {
  return {
    anchors: [],
    closed: false,
    drawPlaneY: 1.2,
    duration: 6,
    fps: 30,
    smoothness: 0.6,
    rounding: 0.8,
    loop: true,
    lookAtMode: 'target',
    target: [0, 1, 0],
    roll: 0,
    fov: 45,
    progressKeys: [],
    cameraKind: 'path',
    staticPose: { ...DEFAULT_STATIC_POSE },
  }
}

function isPristineRig(rig: RigSnapshot) {
  return (
    rig.anchors.length === 0 &&
    rig.duration === 6 &&
    rig.smoothness === 0.6 &&
    rig.rounding === 0.8 &&
    rig.loop &&
    rig.lookAtMode === 'target' &&
    rig.target[0] === 0 &&
    rig.target[1] === 1 &&
    rig.target[2] === 0 &&
    rig.roll === 0 &&
    rig.fov === 45 &&
    (rig.fps ?? 30) === 30 &&
    rig.progressKeys.length === 0 &&
    (rig.cameraKind ?? 'path') === 'path'
  )
}

function uniqueName(options: CameraOption[], requested?: string) {
  const base = requested?.trim() || `Camera ${options.length + 1}`
  if (!options.some((option) => option.name.toLowerCase() === base.toLowerCase())) return base
  let suffix = 2
  while (options.some((option) => option.name.toLowerCase() === `${base} ${suffix}`.toLowerCase())) suffix++
  return `${base} ${suffix}`
}

const initialOption: CameraOption = {
  id: 'camera-default',
  name: 'Camera 1',
  rig: getRigSnapshot(),
  pristine: isPristineRig(getRigSnapshot()),
}

export const useCameraOptionsStore = create<CameraOptionsState>((set, get) => ({
  options: [initialOption],
  activeOptionId: initialOption.id,

  loadOptions: (savedOptions, savedActiveId, fallback) => {
    const options: CameraOption[] =
      savedOptions && savedOptions.length > 0
        ? clone(savedOptions).map((option) => ({ ...option, pristine: option.pristine === true }))
        : [{ id: makeCameraId(), name: 'Camera 1', rig: clone(fallback), pristine: isPristineRig(fallback) }]
    const activeOptionId = options.some((option) => option.id === savedActiveId)
      ? savedActiveId!
      : options[0].id
    set({ options, activeOptionId })
    applyRigSnapshot(options.find((option) => option.id === activeOptionId)!.rig)
  },

  captureActive: () => {
    const { activeOptionId } = get()
    const rig = getRigSnapshot()
    set((state) => ({
      options: state.options.map((option) =>
        option.id === activeOptionId ? { ...option, rig: clone(rig), pristine: false } : option,
      ),
    }))
  },

  createOption: (requestedName, sourceRig) => {
    get().captureActive()
    const state = get()
    const option: CameraOption = {
      id: makeCameraId(),
      name: uniqueName(state.options, requestedName),
      rig: clone(sourceRig ?? getRigSnapshot()),
      pristine: false,
    }
    set({ options: [...state.options, option], activeOptionId: option.id })
    applyRigSnapshot(option.rig)
    return option.id
  },

  switchOption: (id) => {
    const target = get().options.find((option) => option.id === id)
    if (!target || id === get().activeOptionId) return Boolean(target)
    get().captureActive()
    set({ activeOptionId: id })
    applyRigSnapshot(target.rig)
    return true
  },

  renameOption: (id, requestedName) =>
    set((state) => {
      const current = state.options.find((option) => option.id === id)
      const name = requestedName.trim()
      if (!current || !name || current.name === name) return state
      const otherOptions = state.options.filter((option) => option.id !== id)
      return {
        options: state.options.map((option) =>
          option.id === id ? { ...option, name: uniqueName(otherOptions, name) } : option,
        ),
      }
    }),

  removeOption: (id) => {
    const state = get()
    if (state.options.length <= 1) return
    const index = state.options.findIndex((option) => option.id === id)
    if (index < 0) return
    if (id === state.activeOptionId) get().captureActive()
    const options = get().options.filter((option) => option.id !== id)
    const next = options[Math.min(index, options.length - 1)]
    set({ options, activeOptionId: id === state.activeOptionId ? next.id : state.activeOptionId })
    if (id === state.activeOptionId) applyRigSnapshot(next.rig)
  },
}))

/** Serializable options with the live workspace folded into the active camera. */
export function getCameraOptionsSnapshot(): CameraOption[] {
  const state = useCameraOptionsStore.getState()
  const activeRig = getRigSnapshot()
  return clone(
    state.options.map((option) =>
      option.id === state.activeOptionId ? { ...option, rig: activeRig } : option,
    ),
  )
}

/** Start a named assistant-generated option without leaving an unused default camera. */
export function beginGeneratedCameraOption(name: string): CameraOption {
  const state = useCameraOptionsStore.getState()
  const active = state.options.find((option) => option.id === state.activeOptionId)
  const activeIsOnlyEmptyOption =
    state.options.length === 1 && active?.pristine === true && isPristineRig(getRigSnapshot())

  if (active && activeIsOnlyEmptyOption) {
    state.renameOption(active.id, name)
    applyRigSnapshot(makeEmptyRigSnapshot())
    state.captureActive()
    return useCameraOptionsStore.getState().options[0]
  }

  const id = state.createOption(name, makeEmptyRigSnapshot())
  return useCameraOptionsStore.getState().options.find((option) => option.id === id)!
}
