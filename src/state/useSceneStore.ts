import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as THREE from 'three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { KEY_MERGE_EPS, type ModelKey } from '../lib/keyframes'
import type { EaseKind } from '../lib/easing'
import { clamp01 } from '../lib/intervalSpacing'
import {
  buildPrimitiveGeometry,
  defaultParams,
  floorOffsetY,
  PRIMITIVE_DEFS,
  type PrimitiveKind,
  type PrimitiveSpec,
} from '../lib/primitiveGeometry'
import { releasePathParent } from '../lib/pathSpaceBind'
import { useEditorStore } from './useEditorStore'
import { usePathStore } from './usePathStore'
import { useRigStore } from './useRigStore'
import {
  VIEWPORT_BG_DEFAULT_TOP,
  VIEWPORT_BG_LEGACY_DEFAULT,
  VIEWPORT_BG_SLATE_DEFAULT,
} from '../viewport/viewportBackground'
import { boundsAreUsable, meshWorldBounds } from '../lib/prepareImport'

export type Vec3 = [number, number, number]

/**
 * Objects are told apart by grayscale clay shades (per user direction: no
 * colors, tone variation only). New objects cycle through this ramp.
 */
export const SHADE_RAMP = [0.79, 0.55, 0.92, 0.44, 0.68, 0.33, 0.85, 0.6]
let shadeCursor = 0
export const nextShade = () => SHADE_RAMP[shadeCursor++ % SHADE_RAMP.length]

export function makeClayMaterial(shade: number) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setScalar(shade),
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  })
}

/** Center on origin, rest on the floor and normalize to ~2 world units. */
export function normalizeModel(root: THREE.Object3D): THREE.Object3D {
  root.updateMatrixWorld(true)
  const box = meshWorldBounds(root)
  if (!boundsAreUsable(box)) return root

  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  root.scale.multiplyScalar(2 / maxDim)

  root.updateMatrixWorld(true)
  const scaled = meshWorldBounds(root)
  if (!boundsAreUsable(scaled)) return root
  const center = scaled.getCenter(new THREE.Vector3())
  root.position.x -= center.x
  root.position.z -= center.z
  root.position.y -= scaled.min.y
  return root
}

export function applyClay(root: THREE.Object3D, material: THREE.MeshStandardMaterial) {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = material
      child.castShadow = true
      child.receiveShadow = true
    }
  })
}

export interface Transform {
  position: Vec3
  rotation: Vec3 // degrees
  scale: Vec3
}

export const identityTransform: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
}

/** Attaches an object to a motion path so it travels the route in the animation. */
export interface FollowConfig {
  /** id of the MotionPath (in usePathStore) this object rides */
  pathId: string
  /** orient the object along the path tangent (point forward) */
  align: boolean
  /** where on the path the object starts, 0..1 */
  offset: number
  /** vertical lift above the path, world units */
  height: number
  /** roll around the travel direction, degrees (only with align) */
  bank: number
  /** how many times to traverse the path over the timeline */
  loops: number
}

export const defaultFollow = (pathId: string): FollowConfig => ({
  pathId,
  align: true,
  offset: 0,
  height: 0,
  bank: 0,
  loops: 1,
})

export interface SceneObject {
  id: string
  name: string
  root: THREE.Object3D
  material: THREE.MeshStandardMaterial
  /** grayscale tone 0..1 */
  shade: number
  /** IndexedDB key of the source .glb buffer; null for primitives / built-in shape */
  bufferKey: string | null
  /** parametric primitive descriptor (serializable); absent for GLB imports */
  primitive?: PrimitiveSpec
  transform: Transform
  /** pose keyframes on the shared timeline */
  keys: ModelKey[]
  /** animation clips embedded in the imported GLB */
  clips: THREE.AnimationClip[]
  playClips: boolean
  /** when set, the object rides a motion path instead of its pose keyframes */
  follow?: FollowConfig
}

let nextId = 1
export const makeSceneId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${nextId++}`

/**
 * Removed objects are parked here (roots stay alive in memory) so undo/redo
 * can resurrect them — meshes can't be serialized into history snapshots.
 */
export const objectGraveyard = new Map<string, SceneObject>()
const GRAVEYARD_CAP = 40

function bury(object: SceneObject) {
  objectGraveyard.set(object.id, object)
  while (objectGraveyard.size > GRAVEYARD_CAP) {
    const oldest = objectGraveyard.keys().next().value as string
    objectGraveyard.delete(oldest)
  }
}

export function makeObject(
  name: string,
  root: THREE.Object3D,
  options: Partial<
    Pick<SceneObject, 'id' | 'shade' | 'bufferKey' | 'primitive' | 'transform' | 'keys' | 'clips' | 'playClips' | 'follow'>
  > = {},
): SceneObject {
  const shade = options.shade ?? nextShade()
  const material = makeClayMaterial(shade)
  applyClay(root, material)
  return {
    id: options.id ?? makeSceneId('obj'),
    name,
    root,
    material,
    shade,
    bufferKey: options.bufferKey ?? null,
    primitive: options.primitive,
    transform: options.transform ?? identityTransform,
    keys: options.keys ?? [],
    clips: options.clips ?? [],
    playClips: options.playClips ?? true,
    follow: options.follow,
  }
}

/** Build a parametric primitive object (geometry rebuilt from its spec). */
export function makePrimitive(
  kind: PrimitiveKind,
  options: Parameters<typeof makeObject>[2] & { params?: Record<string, number> } = {},
): SceneObject {
  const params = { ...defaultParams(kind), ...(options.params ?? options.primitive?.params ?? {}) }
  const spec: PrimitiveSpec = { kind, params }
  const geometry = buildPrimitiveGeometry(spec)
  const mesh = new THREE.Mesh(geometry)
  mesh.position.y = floorOffsetY(geometry)
  const group = new THREE.Group()
  group.add(mesh)
  const { params: _p, ...rest } = options
  void _p
  return makeObject(PRIMITIVE_DEFS[kind].label, group, { ...rest, bufferKey: null, primitive: spec })
}

export function makeDefaultKnotObject(
  options: Parameters<typeof makeObject>[2] = {},
): SceneObject {
  const group = new THREE.Group()
  group.add(new THREE.Mesh(new THREE.TorusKnotGeometry(0.7, 0.28, 220, 36)))
  normalizeModel(group)
  return makeObject('Torus Knot', group, { bufferKey: null, ...options })
}

export type LiftKind = 'person' | 'prop'

export type PendingLift = { id: string; name: string; kind: LiftKind }

interface SceneState {
  objects: SceneObject[]
  pendingLifts: PendingLift[]
  /** number of model imports currently in flight */
  importing: number
  bgColor: string
  showGrid: boolean
  lightIntensity: number
  onboardingDismissed: boolean
  notice: string | null
  beginLift: (name: string, kind: LiftKind) => string
  renameLift: (id: string, name: string) => void
  endLift: (id: string) => void
  addObject: (object: SceneObject) => void
  addPrimitive: (kind: PrimitiveKind) => void
  updatePrimitiveParams: (id: string, params: Record<string, number>) => void
  removeObject: (id: string) => void
  renameObject: (id: string, name: string) => void
  duplicateObject: (id: string) => void
  setObjectShade: (id: string, shade: number) => void
  setImporting: (delta: number) => void
  setTransform: (id: string, part: keyof Transform, axis: 0 | 1 | 2, value: number) => void
  setTransformAll: (id: string, transform: Transform) => void
  addObjectKey: (id: string, time: number) => void
  updateObjectKeyTime: (id: string, keyId: string, time: number) => void
  setObjectKeyEase: (id: string, keyId: string, ease: EaseKind) => void
  setObjectKeyBezier: (
    id: string,
    keyId: string,
    bezier: [number, number, number, number] | null,
  ) => void
  setObjectKeySpacing: (
    id: string,
    keyId: string,
    patch: { easeIn?: number; easeOut?: number },
    linked?: boolean,
  ) => void
  clearObjectKeySpacing: (id: string, keyId: string) => void
  clearAllObjectSpacing: () => void
  removeObjectKey: (id: string, keyId: string) => void
  clearObjectKeys: (id: string) => void
  applySpinPreset: (id: string) => void
  setPlayClips: (id: string, on: boolean) => void
  /** attach/detach an object to a motion path (null = free, keyframe-driven) */
  setFollow: (id: string, follow: FollowConfig | null) => void
  /**
   * used by undo/redo: restores editable fields, resurrects buried objects and
   * buries the ones absent from the snapshot (so redo can bring them back)
   */
  restoreObjects: (
    snaps: {
      id: string
      transform: Transform
      keys: ModelKey[]
      shade: number
      name: string
      primitive?: PrimitiveSpec
      follow?: FollowConfig
    }[],
  ) => void
  setBgColor: (hex: string) => void
  setShowGrid: (show: boolean) => void
  setLightIntensity: (value: number) => void
  dismissOnboarding: () => void
  showNotice: (message: string) => void
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined

export const useSceneStore = create<SceneState>()(
  persist(
    (set) => {
      const updateObject = (id: string, patch: (o: SceneObject) => Partial<SceneObject>) =>
        set((s) => ({
          objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch(o) } : o)),
        }))

      return {
        objects: [],
        pendingLifts: [],
        importing: 0,
        bgColor: VIEWPORT_BG_DEFAULT_TOP,
        showGrid: true,
        lightIntensity: 1.4,
        onboardingDismissed: false,
        notice: null,

        beginLift: (name, kind) => {
          const id = `lift-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          set((s) => ({ pendingLifts: [...s.pendingLifts, { id, name, kind }] }))
          return id
        },
        renameLift: (id, name) =>
          set((s) => ({
            pendingLifts: s.pendingLifts.map((lift) => (lift.id === id ? { ...lift, name } : lift)),
          })),
        endLift: (id) => set((s) => ({ pendingLifts: s.pendingLifts.filter((lift) => lift.id !== id) })),

        addObject: (object) => set((s) => ({ objects: [...s.objects, object] })),

        addPrimitive: (kind) => {
          const object = makePrimitive(kind)
          set((s) => ({ objects: [...s.objects, object] }))
          useEditorStore.getState().select(`obj:${object.id}`)
        },

        updatePrimitiveParams: (id, params) =>
          updateObject(id, (o) => {
            if (!o.primitive) return {}
            const spec: PrimitiveSpec = { kind: o.primitive.kind, params: { ...o.primitive.params, ...params } }
            const mesh = o.root.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)
            if (mesh) {
              mesh.geometry.dispose()
              mesh.geometry = buildPrimitiveGeometry(spec)
              mesh.position.y = floorOffsetY(mesh.geometry)
            }
            return { primitive: spec }
          }),

        removeObject: (id) =>
          set((s) => {
            const removed = s.objects.find((o) => o.id === id)
            if (removed) bury(removed)
            if (useRigStore.getState().targetObjectId === id) {
              releasePathParent(id, { objects: s.objects, paths: usePathStore.getState().paths })
              useRigStore.getState().setTargetObjectId(null)
            }
            return { objects: s.objects.filter((o) => o.id !== id) }
          }),

        renameObject: (id, name) => updateObject(id, () => ({ name })),

        duplicateObject: (id) =>
          set((s) => {
            const src = s.objects.find((o) => o.id === id)
            if (!src) return s
            const shifted: Vec3 = [
              src.transform.position[0] + 0.8,
              src.transform.position[1],
              src.transform.position[2] + 0.8,
            ]
            const common = {
              transform: { ...src.transform, position: shifted },
              keys: src.keys.map((k) => ({ ...k })),
              playClips: src.playClips,
              shade: src.shade,
              follow: src.follow ? { ...src.follow } : undefined,
            }
            // rebuild primitives from their spec; clone meshes for GLBs
            const copy = src.primitive
              ? makePrimitive(src.primitive.kind, { ...common, params: src.primitive.params })
              : makeObject(`${src.name} copy`, SkeletonUtils.clone(src.root), {
                  ...common,
                  bufferKey: src.bufferKey,
                  clips: src.clips,
                })
            if (src.primitive) copy.name = `${src.name} copy`
            return { objects: [...s.objects, copy] }
          }),

        setObjectShade: (id, shade) =>
          updateObject(id, (o) => {
            o.material.color.setScalar(shade)
            return { shade }
          }),

        setImporting: (delta) => set((s) => ({ importing: Math.max(0, s.importing + delta) })),

        setTransform: (id, part, axis, value) =>
          updateObject(id, (o) => {
            const next = [...o.transform[part]] as Vec3
            next[axis] = value
            return { transform: { ...o.transform, [part]: next } }
          }),

        setTransformAll: (id, transform) => updateObject(id, () => ({ transform })),

        addObjectKey: (id, time) =>
          updateObject(id, (o) => {
            const key: ModelKey = { id: makeSceneId('mkey'), time, transform: o.transform }
            const existing = o.keys.find((k) => Math.abs(k.time - time) < KEY_MERGE_EPS)
            if (existing) {
              return { keys: o.keys.map((k) => (k.id === existing.id ? { ...key, id: k.id } : k)) }
            }
            return { keys: [...o.keys, key] }
          }),

        updateObjectKeyTime: (id, keyId, time) =>
          updateObject(id, (o) => ({
            keys: o.keys.map((k) =>
              k.id === keyId ? { ...k, time: Math.min(1, Math.max(0, time)) } : k,
            ),
          })),

        setObjectKeyEase: (id, keyId, ease) =>
          updateObject(id, (o) => ({
            keys: o.keys.map((k) => {
              if (k.id !== keyId) return k
              const next = { ...k, ease }
              delete next.easeBezier
              return next
            }),
          })),

        setObjectKeyBezier: (id, keyId, bezier) =>
          updateObject(id, (o) => ({
            keys: o.keys.map((k) => {
              if (k.id !== keyId) return k
              const next = { ...k }
              if (bezier) next.easeBezier = bezier
              else delete next.easeBezier
              return next
            }),
          })),

        setObjectKeySpacing: (id, keyId, patch, linked = false) =>
          updateObject(id, (o) => ({
            keys: o.keys.map((k) => {
              if (k.id !== keyId) return k
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
          })),

        clearObjectKeySpacing: (id, keyId) =>
          updateObject(id, (o) => ({
            keys: o.keys.map((k) => {
              if (k.id !== keyId) return k
              const next = { ...k }
              delete next.easeIn
              delete next.easeOut
              return next
            }),
          })),

        clearAllObjectSpacing: () =>
          set((s) => ({
            objects: s.objects.map((o) => ({
              ...o,
              keys: o.keys.map((k) => {
                const next = { ...k }
                delete next.easeIn
                delete next.easeOut
                return next
              }),
            })),
          })),

        removeObjectKey: (id, keyId) =>
          updateObject(id, (o) => ({ keys: o.keys.filter((k) => k.id !== keyId) })),

        clearObjectKeys: (id) => updateObject(id, () => ({ keys: [] })),

        /** full Y turn over the whole timeline, starting from the current pose */
        applySpinPreset: (id) =>
          updateObject(id, (o) => ({
            keys: [0, 0.25, 0.5, 0.75, 1].map((time, i) => ({
              id: makeSceneId('mkey'),
              time,
              transform: {
                ...o.transform,
                rotation: [
                  o.transform.rotation[0],
                  o.transform.rotation[1] + i * 90,
                  o.transform.rotation[2],
                ] as Vec3,
              },
            })),
          })),

        setPlayClips: (id, playClips) => updateObject(id, () => ({ playClips })),

        setFollow: (id, follow) => updateObject(id, () => ({ follow: follow ?? undefined })),

        restoreObjects: (snaps) =>
          set((s) => {
            const live = new Map(s.objects.map((o) => [o.id, o]))
            const next: SceneObject[] = []
            for (const snap of snaps) {
              const base = live.get(snap.id) ?? objectGraveyard.get(snap.id)
              if (!base) continue // root lost (graveyard cap) — cannot resurrect
              base.material.color.setScalar(snap.shade)
              objectGraveyard.delete(snap.id)
              // rebuild the primitive geometry if its params changed
              let primitive = base.primitive
              if (snap.primitive && base.primitive) {
                const mesh = base.root.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)
                if (mesh) {
                  mesh.geometry.dispose()
                  mesh.geometry = buildPrimitiveGeometry(snap.primitive)
                  mesh.position.y = floorOffsetY(mesh.geometry)
                }
                primitive = snap.primitive
              }
              next.push({
                ...base,
                transform: snap.transform,
                keys: snap.keys,
                shade: snap.shade,
                name: snap.name,
                primitive,
                follow: snap.follow,
              })
            }
            for (const o of s.objects) {
              if (!snaps.some((x) => x.id === o.id)) bury(o)
            }
            return { objects: next }
          }),

        setBgColor: (hex) => set({ bgColor: hex }),
        setShowGrid: (showGrid) => set({ showGrid }),
        setLightIntensity: (lightIntensity) => set({ lightIntensity }),
        dismissOnboarding: () => set({ onboardingDismissed: true }),

        showNotice: (message) => {
          clearTimeout(noticeTimer)
          set({ notice: message })
          noticeTimer = setTimeout(() => set({ notice: null }), 2600)
        },
      }
    },
    {
      name: 'rig-scene-settings',
      version: 1,
      partialize: (s) => ({
        bgColor: s.bgColor,
        showGrid: s.showGrid,
        lightIntensity: s.lightIntensity,
        onboardingDismissed: s.onboardingDismissed,
      }),
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Record<string, unknown>
        if (p.bgColor === VIEWPORT_BG_LEGACY_DEFAULT || p.bgColor === VIEWPORT_BG_SLATE_DEFAULT) {
          p.bgColor = VIEWPORT_BG_DEFAULT_TOP
        }
        return p
      },
    },
  ),
)
