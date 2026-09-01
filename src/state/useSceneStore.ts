import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as THREE from 'three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import {
  cloneTransform,
  KEY_MERGE_EPS,
  OBJECT_CHANNELS,
  spliceObjectKeysAtTime,
  type ModelKey,
  type ObjectChannel,
} from '../lib/keyframes'
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
  isShippedViewportBgDefault,
} from '../viewport/viewportBackground'
import { boundsAreUsable, meshWorldBounds } from '../lib/prepareImport'
import {
  applyAssetDisplay,
  captureSourceMaterials,
  createAssetDisplayResources,
  disposeAssetDisplayResources,
  normalizeHexColor,
  shadeToHex,
  sourceMaterialsForClone,
  type AssetDisplayMode,
  type SourceMaterialMap,
} from '../lib/assetDisplay'
import { countRenderedTriangles } from '../lib/geometryStats'
import type { ModelFormat } from '../lib/modelCodec'

export type { ModelFormat } from '../lib/modelCodec'

export type Vec3 = [number, number, number]

/** New objects cycle through grayscale defaults until the user chooses a color. */
export const SHADE_RAMP = [0.79, 0.55, 0.92, 0.44, 0.68, 0.33, 0.85, 0.6]
let shadeCursor = 0
export const nextShade = () => SHADE_RAMP[shadeCursor++ % SHADE_RAMP.length]

/** Center on origin, rest on the floor and normalize to ~2 world units. */
export function normalizeModel(root: THREE.Object3D, opts?: { includePoints?: boolean }): THREE.Object3D {
  root.updateMatrixWorld(true)
  const box = meshWorldBounds(root, { keepPoints: opts?.includePoints })
  if (!boundsAreUsable(box)) return root

  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  root.scale.multiplyScalar(2 / maxDim)

  root.updateMatrixWorld(true)
  const scaled = meshWorldBounds(root, { keepPoints: opts?.includePoints })
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

export function stashImportedMaterials(root: THREE.Object3D) {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && child.userData.rigSourceMaterial == null) {
      child.userData.rigSourceMaterial = child.material
    }
  })
}

export function restoreImportedMaterials(root: THREE.Object3D) {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && child.userData.rigSourceMaterial) {
      child.material = child.userData.rigSourceMaterial
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
  sourceMaterials: SourceMaterialMap
  wireframeMaterial: THREE.MeshStandardMaterial
  displayMode: AssetDisplayMode
  /** grayscale tone 0..1 */
  shade: number
  /** Serializable per-object clay color used by Solid and Wireframe. */
  clayColor: string
  /** IndexedDB key of the source model buffer; null for primitives / built-in shape */
  bufferKey: string | null
  /** Raw source bytes stored under bufferKey. Remesh output always becomes glb. */
  sourceFormat?: 'glb' | 'gltf' | 'obj'
  /** Encoding of the persisted mesh source; legacy imported objects are glTF. */
  modelFormat?: ModelFormat
  /** parametric primitive descriptor (serializable); absent for GLB imports */
  primitive?: PrimitiveSpec
  transform: Transform
  /** pose keyframes on the shared timeline */
  keys: ModelKey[]
  /** animation clips embedded in the imported GLB */
  clips: THREE.AnimationClip[]
  playClips: boolean
  /** which embedded clip the mixer samples; dummy defaults to Idle */
  activeClip?: string
  /** when set, the object rides a motion path instead of its pose keyframes */
  follow?: FollowConfig
  /** Cached so ObjectBar remesh does not walk a dense live mesh every render. */
  triangleCount?: number
  /** True after a remesh GLB replaced the dense source — never restore as a cube. */
  remeshed?: boolean
  rigKind?: import('../lib/environment').RigKind
  /** Scene-block clay: load the GLB, never the remesh cube. */
  keepDenseMesh?: boolean
  /** SAM 3.0 textured GLB — Clay mode can still gray it. */
  keepTexture?: boolean
  /** VGGT coloured point cloud — import keeps THREE.Points, not camera cones. */
  keepPoints?: boolean
  /** Dummy FK pose in degrees, applied when Play clips is off. */
  bonePose?: Record<string, Vec3>
  /** Dummy FK local bone positions that left bind. */
  boneTranslate?: Record<string, Vec3>
  /** Female / Male bundled figure. Ignored unless rigKind is dummy. */
  figureSex?: 'female' | 'male'
}

let nextId = 1
export const makeSceneId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${nextId++}`

/**
 * Removed objects are parked here (roots stay alive in memory) so undo/redo
 * can resurrect them — meshes can't be serialized into history snapshots.
 */
class ObjectGraveyard extends Map<string, SceneObject> {
  clear(): void {
    for (const object of this.values()) disposeAssetDisplayResources(object)
    super.clear()
  }
}

export const objectGraveyard = new ObjectGraveyard()
const GRAVEYARD_CAP = 40

const objectRemovedListeners = new Set<(id: string) => void>()

/** meshJobs aborts an in-flight remesh so delete can undo back to the original mesh. */
export function onSceneObjectRemoved(listener: (id: string) => void) {
  objectRemovedListeners.add(listener)
  return () => {
    objectRemovedListeners.delete(listener)
  }
}

function bury(object: SceneObject) {
  const replaced = objectGraveyard.get(object.id)
  if (replaced && replaced !== object) disposeAssetDisplayResources(replaced)
  objectGraveyard.set(object.id, object)
  while (objectGraveyard.size > GRAVEYARD_CAP) {
    const oldest = objectGraveyard.keys().next().value as string
    const evicted = objectGraveyard.get(oldest)
    objectGraveyard.delete(oldest)
    if (evicted) disposeAssetDisplayResources(evicted)
  }
}

export function clearObjectGraveyard(): void {
  objectGraveyard.clear()
}

export function disposeSceneObjectDisplays(objects: Iterable<SceneObject>): void {
  for (const object of objects) disposeAssetDisplayResources(object)
}

export function makeObject(
  name: string,
  root: THREE.Object3D,
  options: Partial<
    Pick<
      SceneObject,
      'id' | 'shade' | 'clayColor' | 'bufferKey' | 'sourceFormat' | 'modelFormat' | 'primitive' | 'transform' | 'keys' | 'clips' | 'playClips' | 'activeClip' | 'follow' | 'triangleCount' | 'remeshed' | 'rigKind' | 'keepDenseMesh' | 'keepTexture' | 'keepPoints' | 'bonePose' | 'boneTranslate' | 'figureSex' | 'displayMode'
    >
  > = {},
): SceneObject {
  const shade = options.shade ?? nextShade()
  const clayColor = normalizeHexColor(options.clayColor ?? shadeToHex(shade), shadeToHex(shade))
  if (options.keepTexture) stashImportedMaterials(root)
  const displayResources = createAssetDisplayResources(root, shade, clayColor)
  const object: SceneObject = {
    id: options.id ?? makeSceneId('obj'),
    name,
    root,
    ...displayResources,
    displayMode: options.displayMode ?? 'solid',
    shade,
    clayColor,
    bufferKey: options.bufferKey ?? null,
    sourceFormat: options.sourceFormat,
    modelFormat: options.modelFormat,
    primitive: options.primitive,
    transform: options.transform ?? identityTransform,
    keys: options.keys ?? [],
    clips: options.clips ?? [],
    playClips: options.playClips ?? true,
    activeClip: options.activeClip,
    follow: options.follow,
    triangleCount: options.triangleCount ?? countRenderedTriangles(root),
    remeshed: options.remeshed,
    rigKind: options.rigKind ?? 'none',
    keepDenseMesh: options.keepDenseMesh,
    keepTexture: options.keepTexture,
    keepPoints: options.keepPoints,
    bonePose: options.bonePose,
    boneTranslate: options.boneTranslate,
    figureSex: options.figureSex,
  }
  applyAssetDisplay(object, options.keepTexture ? 'look' : 'clay')
  return object
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

export type LiftKind = 'person' | 'prop' | 'generate' | 'remesh'

export type PendingLift = {
  id: string
  name: string
  kind: LiftKind
  objectId?: string
  /** 0..1 when Fal reports a real fraction; null = time-based remesh bar. */
  progress: number | null
  /** Epoch ms when the job entered the queue — drives the remesh clock. */
  startedAt: number
}

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
  beginLift: (name: string, kind: LiftKind, objectId?: string) => string
  renameLift: (id: string, name: string) => void
  setLiftProgress: (id: string, progress: number | null) => void
  endLift: (id: string) => void
  addObject: (object: SceneObject) => void
  replaceImportedRoot: (
    id: string,
    root: THREE.Object3D,
    clips: THREE.AnimationClip[],
    sourceMaterials?: SourceMaterialMap,
    modelFormat?: ModelFormat,
  ) => void
  addPrimitive: (kind: PrimitiveKind) => void
  updatePrimitiveParams: (id: string, params: Record<string, number>) => void
  removeObject: (id: string) => void
  renameObject: (id: string, name: string) => void
  duplicateObject: (id: string) => void
  setObjectShade: (id: string, shade: number) => void
  setObjectColor: (id: string, clayColor: string) => void
  setObjectDisplayMode: (id: string, displayMode: AssetDisplayMode) => void
  setImporting: (delta: number) => void
  setTransform: (id: string, part: keyof Transform, axis: 0 | 1 | 2, value: number) => void
  setTransformAll: (id: string, transform: Transform) => void
  addObjectKey: (id: string, time: number, channel?: ObjectChannel) => void
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
  removeObjectKey: (id: string, keyId: string, channel?: ObjectChannel) => void
  removeObjectKeysAtTime: (id: string, time: number, channels: ObjectChannel[]) => void
  clearObjectKeys: (id: string) => void
  applySpinPreset: (id: string) => void
  setPlayClips: (id: string, on: boolean) => void
  setBonePose: (id: string, bonePose: Record<string, Vec3> | undefined) => void
  setDummyFk: (
    id: string,
    patch: {
      bonePose?: Record<string, Vec3>
      boneTranslate?: Record<string, Vec3>
      playClips?: boolean
    },
  ) => void
  setActiveClip: (id: string, name: string) => void
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
      clayColor?: string
      name: string
      primitive?: PrimitiveSpec
      follow?: FollowConfig
      bonePose?: Record<string, Vec3>
      boneTranslate?: Record<string, Vec3>
      playClips?: boolean
      figureSex?: 'female' | 'male'
      activeClip?: string
      displayMode?: AssetDisplayMode
    }[],
  ) => void
  setBgColor: (hex: string) => void
  setShowGrid: (show: boolean) => void
  setLightIntensity: (value: number) => void
  dismissOnboarding: () => void
  showNotice: (message: string, durationMs?: number) => void
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

        beginLift: (name, kind, objectId) => {
          const id = `lift-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          set((s) => ({
            pendingLifts: [
              ...s.pendingLifts,
              { id, name, kind, objectId, progress: null, startedAt: Date.now() },
            ],
          }))
          return id
        },
        renameLift: (id, name) =>
          set((s) => ({
            pendingLifts: s.pendingLifts.map((lift) => (lift.id === id ? { ...lift, name } : lift)),
          })),
        setLiftProgress: (id, progress) =>
          set((s) => ({
            pendingLifts: s.pendingLifts.map((lift) => (lift.id === id ? { ...lift, progress } : lift)),
          })),
        endLift: (id) => set((s) => ({ pendingLifts: s.pendingLifts.filter((lift) => lift.id !== id) })),

        addObject: (object) => set((s) => ({ objects: [...s.objects, object] })),

        replaceImportedRoot: (id, root, clips, sourceMaterials, modelFormat) =>
          updateObject(id, (o) => {
            const next = {
              ...o,
              root,
              clips,
              primitive: undefined,
              sourceMaterials: sourceMaterials ?? captureSourceMaterials(root),
              triangleCount: root.userData.rigRemeshPlaceholder ? o.triangleCount : countRenderedTriangles(root),
              modelFormat: modelFormat ?? o.modelFormat,
            }
            applyAssetDisplay(next, useEditorStore.getState().viewMode)
            return next
          }),

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
            return { primitive: spec, triangleCount: countRenderedTriangles(o.root) }
          }),

        removeObject: (id) => {
          set((s) => {
            const removed = s.objects.find((o) => o.id === id)
            if (removed) bury(removed)
            if (useRigStore.getState().targetObjectId === id) {
              releasePathParent(id, { objects: s.objects, paths: usePathStore.getState().paths })
              useRigStore.getState().setTargetObjectId(null)
            }
            return { objects: s.objects.filter((o) => o.id !== id) }
          })
          for (const listener of objectRemovedListeners) listener(id)
        },

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
              activeClip: src.activeClip,
              shade: src.shade,
              clayColor: src.clayColor,
              sourceFormat: src.sourceFormat,
              follow: src.follow ? { ...src.follow } : undefined,
              rigKind: src.rigKind,
              remeshed: src.remeshed,
              keepDenseMesh: src.keepDenseMesh,
              keepTexture: src.keepTexture,
              keepPoints: src.keepPoints,
              bonePose: src.bonePose ? { ...src.bonePose } : undefined,
              boneTranslate: src.boneTranslate ? { ...src.boneTranslate } : undefined,
              figureSex: src.figureSex,
              displayMode: src.displayMode,
              modelFormat: src.modelFormat,
            }
            // rebuild primitives from their spec; clone meshes for GLBs
            let copy: SceneObject
            if (src.primitive) {
              copy = makePrimitive(src.primitive.kind, { ...common, params: src.primitive.params })
            } else {
              const clonedRoot = SkeletonUtils.clone(src.root)
              sourceMaterialsForClone(src, clonedRoot)
              copy = makeObject(`${src.name} copy`, clonedRoot, {
                  ...common,
                  bufferKey: src.bufferKey,
                  clips: src.clips,
                  triangleCount: src.triangleCount,
                })
            }
            if (src.primitive) copy.name = `${src.name} copy`
            return { objects: [...s.objects, copy] }
          }),

        setObjectShade: (id, shade) =>
          updateObject(id, (o) => {
            const clayColor = shadeToHex(shade)
            o.material.color.set(clayColor)
            o.wireframeMaterial.color.set(clayColor)
            return { shade, clayColor }
          }),

        setObjectColor: (id, value) =>
          updateObject(id, (o) => {
            const clayColor = normalizeHexColor(value, o.clayColor)
            o.material.color.set(clayColor)
            o.wireframeMaterial.color.set(clayColor)
            return { clayColor }
          }),

        setObjectDisplayMode: (id, displayMode) =>
          updateObject(id, (o) => {
            const next = { ...o, displayMode }
            applyAssetDisplay(next, useEditorStore.getState().viewMode)
            return { displayMode }
          }),

        setImporting: (delta) => set((s) => ({ importing: Math.max(0, s.importing + delta) })),

        setTransform: (id, part, axis, value) =>
          updateObject(id, (o) => {
            const next = [...o.transform[part]] as Vec3
            next[axis] = value
            return { transform: { ...o.transform, [part]: next } }
          }),

        setTransformAll: (id, transform) => updateObject(id, () => ({ transform })),

        addObjectKey: (id, time, channel) =>
          updateObject(id, (o) => {
            const channels: ObjectChannel[] = channel ? [channel] : [...OBJECT_CHANNELS]
            let keys = o.keys
            for (const ch of channels) {
              const key: ModelKey = {
                id: makeSceneId('mkey'),
                time,
                channel: ch,
                transform: cloneTransform(o.transform),
              }
              const existing = keys.find(
                (k) => Math.abs(k.time - time) < KEY_MERGE_EPS && k.channel === ch,
              )
              keys = existing
                ? keys.map((k) => (k.id === existing.id ? { ...key, id: k.id } : k))
                : [...keys, key]
            }
            return { keys }
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

        removeObjectKey: (id, keyId, channel) =>
          updateObject(id, (o) => {
            const key = o.keys.find((item) => item.id === keyId)
            if (!key) return {}
            if (channel && (key.channel ?? 'pose') === 'pose') {
              return {
                keys: spliceObjectKeysAtTime(o.keys, key.time, [channel], () => makeSceneId('mkey')),
              }
            }
            return { keys: o.keys.filter((k) => k.id !== keyId) }
          }),

        removeObjectKeysAtTime: (id, time, channels) =>
          updateObject(id, (o) => ({
            keys: spliceObjectKeysAtTime(o.keys, time, channels, () => makeSceneId('mkey')),
          })),

        clearObjectKeys: (id) => updateObject(id, () => ({ keys: [] })),

        /** full Y turn over the whole timeline, starting from the current pose */
        applySpinPreset: (id) =>
          updateObject(id, (o) => ({
            keys: [0, 0.25, 0.5, 0.75, 1].map((time, i) => ({
              id: makeSceneId('mkey'),
              time,
              channel: 'rotation' as const,
              transform: {
                ...cloneTransform(o.transform),
                rotation: [
                  o.transform.rotation[0],
                  o.transform.rotation[1] + i * 90,
                  o.transform.rotation[2],
                ] as Vec3,
              },
            })),
          })),

        setPlayClips: (id, playClips) => updateObject(id, () => ({ playClips })),
        setBonePose: (id, bonePose) => updateObject(id, () => ({ bonePose })),
        setDummyFk: (id, patch) => updateObject(id, () => patch),
        setActiveClip: (id, activeClip) => updateObject(id, () => ({ activeClip })),

        setFollow: (id, follow) => updateObject(id, () => ({ follow: follow ?? undefined })),

        restoreObjects: (snaps) =>
          set((s) => {
            const live = new Map(s.objects.map((o) => [o.id, o]))
            const next: SceneObject[] = []
            for (const snap of snaps) {
              const base = live.get(snap.id) ?? objectGraveyard.get(snap.id)
              if (!base) continue // root lost (graveyard cap) — cannot resurrect
              const clayColor = normalizeHexColor(
                snap.clayColor ?? shadeToHex(snap.shade),
                shadeToHex(snap.shade),
              )
              base.material.color.set(clayColor)
              base.wireframeMaterial.color.set(clayColor)
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
              const restored = {
                ...base,
                transform: snap.transform,
                keys: snap.keys,
                shade: snap.shade,
                clayColor,
                name: snap.name,
                primitive,
                follow: snap.follow,
                bonePose: 'bonePose' in snap ? snap.bonePose : base.bonePose,
                boneTranslate: 'boneTranslate' in snap ? snap.boneTranslate : base.boneTranslate,
                playClips: snap.playClips ?? base.playClips,
                figureSex: snap.figureSex ?? base.figureSex,
                activeClip: 'activeClip' in snap ? snap.activeClip : base.activeClip,
                displayMode: snap.displayMode ?? 'solid',
              }
              applyAssetDisplay(restored, useEditorStore.getState().viewMode)
              next.push(restored)
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

        showNotice: (message, durationMs = 2600) => {
          clearTimeout(noticeTimer)
          set({ notice: message })
          noticeTimer = setTimeout(() => set({ notice: null }), durationMs)
        },
      }
    },
    {
      name: 'rig-scene-settings',
      version: 2,
      partialize: (s) => ({
        bgColor: s.bgColor,
        showGrid: s.showGrid,
        lightIntensity: s.lightIntensity,
        onboardingDismissed: s.onboardingDismissed,
      }),
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Record<string, unknown>
        if (isShippedViewportBgDefault(p.bgColor)) {
          p.bgColor = VIEWPORT_BG_DEFAULT_TOP
        }
        return p
      },
    },
  ),
)
