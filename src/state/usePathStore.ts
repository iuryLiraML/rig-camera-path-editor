import { create } from 'zustand'
import type { Vec3 } from './useSceneStore'
import { computeAutoHandles, type TangentMode } from '../lib/curve'
import {
  clickAnchorSelection,
  primaryAnchorId,
  transformAnchorsAroundPivot,
  translateAnchors,
  type AnchorPoseSnapshot,
} from '../lib/anchorSelection'

export interface PathAnchor {
  id: string
  position: Vec3
  /** relative to position; only meaningful when manual=true */
  handleIn: Vec3
  /** relative to position; only meaningful when manual=true */
  handleOut: Vec3
  mirrored: boolean
  /** false = handles are auto-computed from the rounding slider */
  manual: boolean
}

export interface MotionPath {
  id: string
  name: string
  anchors: PathAnchor[]
  closed: boolean
  rounding: number
}

/** the camera's path always uses this fixed id within a project */
export const CAMERA_PATH_ID = 'camera-path'

const negate = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]]
let nextId = 1
const makeId = (p: string) => `${p}-${Date.now().toString(36)}-${nextId++}`

export const makeAnchor = (position: Vec3): PathAnchor => ({
  id: makeId('anchor'),
  position,
  handleIn: [0, 0, 0],
  handleOut: [0, 0, 0],
  mirrored: true,
  manual: false,
})

function makeCameraPath(): MotionPath {
  return { id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }
}

export interface PathState {
  paths: MotionPath[]
  activePathId: string
  selectedAnchorId: string | null
  /** Shift+click accumulates; last id is the primary (inspector / handles). */
  selectedAnchorIds: string[]
  selectedHandle: 'none' | 'in' | 'out'
  drawPlaneY: number

  // collection
  createPath: (name?: string) => string
  removePath: (id: string) => void
  renamePath: (id: string, name: string) => void
  duplicatePath: (id: string) => string
  setActivePath: (id: string) => void
  getPath: (id: string) => MotionPath | undefined
  /** overwrite (or create) a path's geometry — used by presets and snapshots */
  setPathData: (id: string, data: Partial<Omit<MotionPath, 'id'>>) => void

  // ops on the ACTIVE path (same signatures as the old rig path ops)
  addAnchor: (position: Vec3) => string
  insertAnchor: (index: number, position: Vec3) => void
  setPath: (positions: Vec3[], closed: boolean) => void
  updateAnchorPosition: (id: string, position: Vec3) => void
  /** Move every selected point by the same world/local delta. */
  translateSelectedAnchors: (delta: Vec3) => void
  /** Apply a TransformControls pose to the selected points as a group. */
  applyAnchorGroupTransform: (args: {
    snapshot: AnchorPoseSnapshot[]
    startPivot: Vec3
    currentPivot: Vec3
    quat: readonly [number, number, number, number]
    scale: Vec3
  }) => void
  setHandleOut: (id: string, handleOut: Vec3, mirror: boolean) => void
  setHandle: (id: string, which: 'in' | 'out', value: Vec3, breakMirror: boolean) => void
  setAnchorTangent: (id: string, mode: TangentMode) => void
  setAnchorsTangent: (ids: string[], mode: TangentMode) => void
  removeAnchor: (id: string) => void
  removeAnchors: (ids: string[]) => void
  clearPath: () => void
  setClosed: (closed: boolean) => void
  setRounding: (r: number) => void
  setPathHeight: (y: number) => void
  setAnchorHeight: (id: string, y: number) => void
  setAnchorsHeight: (ids: string[], y: number) => void
  autoSmoothAll: () => void
  selectAnchor: (id: string | null, additive?: boolean) => void
  selectHandle: (which: 'none' | 'in' | 'out') => void
  setDrawPlaneY: (y: number) => void
}

/** anchor count of the camera path — for "has a camera path" gates */
export const selectCameraAnchorCount = (s: PathState) =>
  s.paths.find((p) => p.id === CAMERA_PATH_ID)?.anchors.length ?? 0

export const usePathStore = create<PathState>((set, get) => {
  /** apply a mutation to the active path's anchors */
  const editActive = (fn: (p: MotionPath) => Partial<MotionPath>) =>
    set((s) => ({
      paths: s.paths.map((p) => (p.id === s.activePathId ? { ...p, ...fn(p) } : p)),
    }))

  const clearSelection = {
    selectedAnchorId: null as string | null,
    selectedAnchorIds: [] as string[],
    selectedHandle: 'none' as const,
  }

  const soleSelection = (id: string) => ({
    selectedAnchorId: id,
    selectedAnchorIds: [id],
    selectedHandle: 'none' as const,
  })

  return {
    paths: [makeCameraPath()],
    activePathId: CAMERA_PATH_ID,
    selectedAnchorId: null,
    selectedAnchorIds: [],
    selectedHandle: 'none',
    drawPlaneY: 1.2,

    createPath: (name) => {
      const id = makeId('path')
      set((s) => ({
        paths: [
          ...s.paths,
          { id, name: name ?? `Path ${s.paths.filter((p) => p.id !== CAMERA_PATH_ID).length + 1}`, anchors: [], closed: false, rounding: 0.8 },
        ],
        activePathId: id,
        ...clearSelection,
      }))
      return id
    },

    removePath: (id) =>
      set((s) => {
        if (id === CAMERA_PATH_ID) return s // camera path is permanent
        const paths = s.paths.filter((p) => p.id !== id)
        return {
          paths,
          activePathId: s.activePathId === id ? CAMERA_PATH_ID : s.activePathId,
          ...clearSelection,
        }
      }),

    renamePath: (id, name) =>
      set((s) => ({ paths: s.paths.map((p) => (p.id === id ? { ...p, name } : p)) })),

    duplicatePath: (id) => {
      const src = get().paths.find((p) => p.id === id)
      const newId = makeId('path')
      if (src) {
        set((s) => ({
          paths: [
            ...s.paths,
            { ...src, id: newId, name: `${src.name} copy`, anchors: src.anchors.map((a) => ({ ...a, id: makeId('anchor') })) },
          ],
          activePathId: newId,
        }))
      }
      return newId
    },

    setActivePath: (activePathId) => set({ activePathId, ...clearSelection }),

    getPath: (id) => get().paths.find((p) => p.id === id),

    setPathData: (id, data) =>
      set((s) => {
        const exists = s.paths.some((p) => p.id === id)
        if (exists) return { paths: s.paths.map((p) => (p.id === id ? { ...p, ...data } : p)) }
        return {
          paths: [
            ...s.paths,
            { id, name: data.name ?? 'Path', anchors: data.anchors ?? [], closed: data.closed ?? false, rounding: data.rounding ?? 0.8 },
          ],
        }
      }),

    addAnchor: (position) => {
      const anchor = makeAnchor(position)
      editActive((p) => ({ anchors: [...p.anchors, anchor] }))
      set(soleSelection(anchor.id))
      return anchor.id
    },

    insertAnchor: (index, position) => {
      const anchor = makeAnchor(position)
      editActive((p) => {
        const anchors = [...p.anchors]
        anchors.splice(Math.min(anchors.length, Math.max(0, index)), 0, anchor)
        return { anchors }
      })
      set(soleSelection(anchor.id))
    },

    setPath: (positions, closed) => {
      editActive(() => ({ anchors: positions.map(makeAnchor), closed }))
      set(clearSelection)
    },

    updateAnchorPosition: (id, position) =>
      editActive((p) => ({ anchors: p.anchors.map((a) => (a.id === id ? { ...a, position } : a)) })),

    translateSelectedAnchors: (delta) =>
      editActive((p) => ({
        anchors: translateAnchors(p.anchors, get().selectedAnchorIds, delta),
      })),

    applyAnchorGroupTransform: ({ snapshot, startPivot, currentPivot, quat, scale }) =>
      editActive((p) => ({
        anchors: transformAnchorsAroundPivot(p.anchors, snapshot, startPivot, currentPivot, quat, scale),
      })),

    setHandleOut: (id, handleOut, mirror) =>
      editActive((p) => ({
        anchors: p.anchors.map((a) =>
          a.id === id
            ? { ...a, manual: true, handleOut, handleIn: mirror ? negate(handleOut) : a.handleIn, mirrored: mirror }
            : a,
        ),
      })),

    setHandle: (id, which, value, breakMirror) =>
      editActive((p) => ({
        anchors: p.anchors.map((a) => {
          if (a.id !== id) return a
          const mirrored = breakMirror ? false : a.mirrored
          if (which === 'out') {
            return { ...a, manual: true, mirrored, handleOut: value, handleIn: mirrored ? negate(value) : a.handleIn }
          }
          return { ...a, manual: true, mirrored, handleIn: value, handleOut: mirrored ? negate(value) : a.handleOut }
        }),
      })),

    setAnchorTangent: (id, mode) => {
      get().setAnchorsTangent([id], mode)
    },

    setAnchorsTangent: (ids, mode) =>
      editActive((p) => {
        const wanted = new Set(ids)
        let anchors = p.anchors.map((a) => ({ ...a }))
        for (let idx = 0; idx < anchors.length; idx++) {
          if (!wanted.has(anchors[idx].id)) continue
          const target = anchors[idx]
          if (mode === 'auto') {
            target.manual = false
          } else if (mode === 'corner') {
            target.manual = true
            target.mirrored = true
            target.handleIn = [0, 0, 0]
            target.handleOut = [0, 0, 0]
          } else {
            const seeded = computeAutoHandles(
              anchors.map((a, i) => (i === idx ? { ...a, manual: false } : a)),
              p.closed,
              p.rounding,
            )[idx]
            target.manual = true
            if (mode === 'smooth') {
              target.mirrored = true
              target.handleOut = seeded.handleOut
              target.handleIn = negate(seeded.handleOut)
            } else {
              target.mirrored = false
              target.handleOut = seeded.handleOut
              target.handleIn = seeded.handleIn
            }
          }
        }
        return { anchors }
      }),

    removeAnchor: (id) => {
      get().removeAnchors([id])
    },

    removeAnchors: (ids) => {
      const drop = new Set(ids)
      editActive((p) => ({ anchors: p.anchors.filter((a) => !drop.has(a.id)) }))
      set((s) => {
        const selectedAnchorIds = s.selectedAnchorIds.filter((id) => !drop.has(id))
        return {
          selectedAnchorIds,
          selectedAnchorId: primaryAnchorId(selectedAnchorIds),
          selectedHandle: selectedAnchorIds.length === 0 ? 'none' : s.selectedHandle,
        }
      })
    },

    clearPath: () => {
      editActive(() => ({ anchors: [], closed: false }))
      set(clearSelection)
    },

    setClosed: (closed) => editActive(() => ({ closed })),
    setRounding: (r) => editActive(() => ({ rounding: Math.min(1, Math.max(0, r)) })),

    setPathHeight: (y) => {
      editActive((p) => ({ anchors: p.anchors.map((a) => ({ ...a, position: [a.position[0], y, a.position[2]] as Vec3 })) }))
      set({ drawPlaneY: y })
    },

    setAnchorHeight: (id, y) => {
      get().setAnchorsHeight([id], y)
    },

    setAnchorsHeight: (ids, y) => {
      const wanted = new Set(ids)
      editActive((p) => ({
        anchors: p.anchors.map((a) =>
          wanted.has(a.id) ? { ...a, position: [a.position[0], y, a.position[2]] as Vec3 } : a,
        ),
      }))
    },

    autoSmoothAll: () => editActive((p) => ({ anchors: p.anchors.map((a) => ({ ...a, manual: false })) })),

    selectAnchor: (id, additive = false) => {
      if (id === null) {
        set(clearSelection)
        return
      }
      const selectedAnchorIds = clickAnchorSelection(get().selectedAnchorIds, id, additive)
      set({
        selectedAnchorIds,
        selectedAnchorId: primaryAnchorId(selectedAnchorIds),
        selectedHandle: 'none',
      })
    },
    selectHandle: (selectedHandle) => set({ selectedHandle }),
    setDrawPlaneY: (drawPlaneY) => set({ drawPlaneY }),
  }
})
