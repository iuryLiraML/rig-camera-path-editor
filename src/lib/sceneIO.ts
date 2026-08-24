import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  makeDefaultKnotObject,
  makeObject,
  makePrimitive,
  normalizeModel,
  objectGraveyard,
  useSceneStore,
  type FollowConfig,
  type SceneObject,
  type Transform,
} from '../state/useSceneStore'
import type { PrimitiveSpec } from './primitiveGeometry'
import { useRigStore } from '../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { useEditorStore } from '../state/useEditorStore'
import { makeEmptyRigSnapshot, useCameraOptionsStore } from '../state/useCameraOptionsStore'
import { idbDelete, idbGet, idbKeys, idbPut, STORES } from './idb'
import { resetHistory, historyClock, historyIsDirty } from './history'
import type { ModelKey } from './keyframes'
import { prepareImportedRoot } from './prepareImport'
import { VIEWPORT_BG_DEFAULT_TOP } from '../viewport/viewportBackground'
import { configureFal, falUsable } from './fal/client'
import { readFalSettings } from './fal/settings'

/** legacy (pre-projects) localStorage key — still read for migration */
export const LEGACY_META_KEY = 'rig-scene-objects'
/** toast + remesh offer */
export const RETOPO_TRIANGLES = 80_000
/** stronger FPS copy in the import warning */
export const HEAVY_TRIANGLES = 1_500_000
/** Tripo remesh input cap (fal.ai mesh_url). */
export const FAL_REMESH_MAX_BYTES = 150 * 1024 * 1024

type DenseRemeshEnqueue = (objectId: string, buffer: ArrayBuffer) => void
let denseRemeshEnqueue: DenseRemeshEnqueue | null = null

/** meshJobs registers this so import can auto-send without a circular import. */
export function setDenseRemeshEnqueue(fn: DenseRemeshEnqueue | null) {
  denseRemeshEnqueue = fn
}

export function formatTriangleCount(triangles: number): string {
  if (triangles >= 1_000_000) return `${(triangles / 1e6).toFixed(1)}M triangles`
  if (triangles >= 1000) return `${Math.round(triangles / 1000)}k triangles`
  return `${triangles} triangles`
}

export function denseRemeshStartCopy(name: string, triangles: number): string {
  return `"${name}" is dense (${formatTriangleCount(triangles)}). Remeshing with Tripo…`
}

export function denseRemeshNeedsKeyCopy(name: string, triangles: number): string {
  return `"${name}" is dense (${formatTriangleCount(triangles)}). Add a Fal key in Settings to remesh.`
}

export function remeshTooLargeCopy(name: string): string {
  return `"${name}" is too large to remesh (max 150 MB).`
}

export type DenseImportAction =
  | { action: 'import' }
  | { action: 'remesh'; notice: string }
  | { action: 'skip'; notice: string }

export function denseImportDecision(
  name: string,
  triangles: number,
  byteSize: number,
  falReady: boolean,
): DenseImportAction {
  if (triangles <= RETOPO_TRIANGLES) return { action: 'import' }
  if (byteSize > FAL_REMESH_MAX_BYTES) return { action: 'skip', notice: remeshTooLargeCopy(name) }
  if (!falReady) return { action: 'skip', notice: denseRemeshNeedsKeyCopy(name, triangles) }
  return { action: 'remesh', notice: denseRemeshStartCopy(name, triangles) }
}

function falReady(): boolean {
  configureFal(readFalSettings().falKey)
  return falUsable()
}

export function disposeObject3D(root: THREE.Object3D) {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose()
  })
}

export function makeRemeshPlaceholderRoot(): THREE.Object3D {
  const group = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2))
  mesh.position.y = 0.6
  group.add(mesh)
  return group
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function parseGLB(buffer: ArrayBuffer) {
  return new Promise<{ scene: THREE.Object3D; clips: THREE.AnimationClip[] }>(
    (resolve, reject) => {
      new GLTFLoader().parse(
        buffer,
        '',
        (gltf) => resolve({ scene: gltf.scene, clips: gltf.animations ?? [] }),
        reject,
      )
    },
  )
}

export function parseGlbBuffer(buffer: ArrayBuffer) {
  return parseGLB(buffer)
}

export function countTriangles(root: THREE.Object3D): number {
  let total = 0
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geometry = child.geometry as THREE.BufferGeometry
      total += (geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3
    }
  })
  return Math.round(total)
}

function addImportedObject(
  name: string,
  root: THREE.Object3D,
  clips: THREE.AnimationClip[],
): SceneObject {
  const object = makeObject(name, root, { bufferKey: null, clips })
  object.bufferKey = object.id
  useSceneStore.getState().addObject(object)
  useEditorStore.getState().select(`obj:${object.id}`)
  return object
}

/** Imports GLB bytes as a new scene object and persists the buffer. */
export async function importModelBuffer(
  buffer: ArrayBuffer,
  name: string,
  opts: { announce?: boolean; autoRemesh?: boolean } = {},
): Promise<{
  objectId: string
  objectName: string
  byteSize: number
  triangles: number
} | null> {
  const announce = opts.announce ?? true
  const autoRemesh = opts.autoRemesh ?? false
  const scene = useSceneStore.getState()
  scene.setImporting(1)
  try {
    const { scene: root, clips } = await parseGLB(buffer)
    prepareImportedRoot(root)
    const triangles = countTriangles(root)

    if (autoRemesh && triangles > RETOPO_TRIANGLES) {
      disposeObject3D(root)
      const decision = denseImportDecision(name, triangles, buffer.byteLength, falReady())
      switch (decision.action) {
        case 'skip':
          scene.showNotice(decision.notice)
          return null
        case 'import':
          return null
        case 'remesh': {
          const placeholder = addImportedObject(name, makeRemeshPlaceholderRoot(), [])
          scene.showNotice(decision.notice)
          denseRemeshEnqueue?.(placeholder.id, buffer)
          return {
            objectId: placeholder.id,
            objectName: placeholder.name,
            byteSize: buffer.byteLength,
            triangles,
          }
        }
        default: {
          const _exhaustive: never = decision
          return _exhaustive
        }
      }
    }

    normalizeModel(root)
    const object = addImportedObject(name, root, clips)

    if (announce) {
      if (triangles > HEAVY_TRIANGLES) {
        scene.showNotice(
          `"${name}" is heavy (${(triangles / 1e6).toFixed(1)}M triangles) — expect low FPS`,
        )
      } else if (triangles > RETOPO_TRIANGLES) {
        scene.showNotice(
          `"${name}" is dense (${Math.round(triangles / 1000)}k triangles) — Remesh from the object bar`,
        )
      } else {
        scene.showNotice(
          clips.length ? `"${name}" imported (${clips.length} animation clips)` : `"${name}" imported`,
        )
      }
    }
    try {
      await idbPut(STORES.buffers, buffer, object.id)
    } catch (error) {
      console.error('Failed to persist model buffer', error)
      scene.showNotice(`"${name}" imported, but remesh needs a re-import`)
    }
    return { objectId: object.id, objectName: object.name, byteSize: buffer.byteLength, triangles }
  } catch (error) {
    console.error('Failed to import model', error)
    scene.showNotice('Could not read this file — use a self-contained .glb')
    return null
  } finally {
    useSceneStore.getState().setImporting(-1)
  }
}

/** Imports a .glb/.gltf file as a new scene object and persists its buffer. */
export async function importModelFile(
  file: File,
  opts: { announce?: boolean; autoRemesh?: boolean } = {},
): Promise<{
  objectId: string
  objectName: string
  byteSize: number
  triangles: number
} | null> {
  const name = file.name.replace(/\.(glb|gltf)$/i, '')
  return importModelBuffer(await file.arrayBuffer(), name, { autoRemesh: true, ...opts })
}

const meshRevisions: { objectId: string; buffer: ArrayBuffer; clock: number }[] = []

export function objectTriangleCount(objectId: string): number {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  return object ? countTriangles(object.root) : 0
}

export function objectNeedsRetopo(objectId: string): boolean {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  return Boolean(object?.bufferKey) && objectTriangleCount(objectId) > RETOPO_TRIANGLES
}

export async function replaceImportedBuffer(
  objectId: string,
  buffer: ArrayBuffer,
  opts: { recordUndo?: boolean } = {},
): Promise<void> {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object?.bufferKey) throw new Error('Only imported models can be remeshed.')
  const previous =
    opts.recordUndo === false ? undefined : await idbGet<ArrayBuffer>(STORES.buffers, object.bufferKey)
  const { scene: root, clips } = await parseGLB(buffer)
  prepareImportedRoot(root)
  normalizeModel(root)
  useSceneStore.getState().replaceImportedRoot(objectId, root, clips)
  await idbPut(STORES.buffers, buffer, object.bufferKey)
  if (previous) meshRevisions.push({ objectId, buffer: previous, clock: historyClock() })
}

/** Restores the last remesh of `objectId` only when it is the latest edit. */
export function undoLastMeshRevision(objectId?: string | null): boolean {
  if (!objectId || historyIsDirty()) return false
  const clock = historyClock()
  for (let index = meshRevisions.length - 1; index >= 0; index--) {
    const revision = meshRevisions[index]
    if (revision.objectId !== objectId) continue
    if (revision.clock < clock) return false
    const live = useSceneStore.getState().objects.find((item) => item.id === objectId)
    meshRevisions.splice(index, 1)
    if (!live?.bufferKey) continue
    void replaceImportedBuffer(revision.objectId, revision.buffer, { recordUndo: false }).catch(
      (error) => {
        meshRevisions.push(revision)
        console.error('Failed to restore original mesh', error)
        useSceneStore.getState().showNotice('Could not restore the original mesh')
      },
    )
    return true
  }
  return false
}

export function pushMeshRevisionForTests(objectId: string, buffer: ArrayBuffer, clock = historyClock()) {
  meshRevisions.push({ objectId, buffer, clock })
}

export function clearMeshRevisions() {
  meshRevisions.length = 0
}

export const clearMeshRevisionsForTests = clearMeshRevisions

export function openImportDialog() {
  useEditorStore.getState().setShowImportModal(true)
}

/** Imports .glb/.gltf files; dense meshes auto-queue for Tripo remesh. */
export async function importDroppedModels(files: File[]): Promise<void> {
  const models = files.filter((file) => /\.(glb|gltf)$/i.test(file.name))
  if (models.length === 0) {
    useSceneStore.getState().showNotice('Unsupported file — drop a .glb or .gltf')
    return
  }
  for (const file of models) {
    const imported = await importModelFile(file, { announce: false })
    if (!imported) continue
    if (imported.triangles <= RETOPO_TRIANGLES) {
      useSceneStore.getState().showNotice(`"${imported.objectName}" imported`)
    }
  }
}

// ---------------------------------------------------------------------------
// Scene <-> serializable metadata
// ---------------------------------------------------------------------------

export interface ObjectMeta {
  id: string
  name: string
  shade: number
  bufferKey: string | null
  primitive?: PrimitiveSpec
  transform: Transform
  keys: ModelKey[]
  playClips: boolean
  follow?: FollowConfig
}

export function toMeta(o: SceneObject): ObjectMeta {
  return {
    id: o.id,
    name: o.name,
    shade: o.shade,
    bufferKey: o.bufferKey,
    primitive: o.primitive,
    transform: o.transform,
    keys: o.keys,
    playClips: o.playClips,
    follow: o.follow,
  }
}

export function liveSceneMetas(): ObjectMeta[] {
  return useSceneStore.getState().objects.map(toMeta)
}

/** Clears the current scene and rebuilds it from metadata + stored buffers. */
export async function loadSceneFromMetas(metas: ObjectMeta[], seedIfEmpty = true) {
  objectGraveyard.clear()
  useSceneStore.setState({ objects: [] })

  for (const meta of metas) {
    try {
      let object: SceneObject
      if (meta.primitive) {
        object = makePrimitive(meta.primitive.kind, { ...meta, params: meta.primitive.params })
        object.name = meta.name
      } else if (meta.bufferKey === null) {
        object = makeDefaultKnotObject(meta)
        object.name = meta.name
      } else {
        const buffer = await idbGet<ArrayBuffer>(STORES.buffers, meta.bufferKey)
        if (!buffer) continue // buffer lost (cleared storage) — skip quietly
        const { scene: root, clips } = await parseGLB(buffer)
        prepareImportedRoot(root)
        normalizeModel(root)
        object = makeObject(meta.name, root, { ...meta, clips })
      }
      useSceneStore.getState().addObject(object)
    } catch (e) {
      console.error('Failed to restore object', meta.name, e)
    }
  }

  if (seedIfEmpty && useSceneStore.getState().objects.length === 0) {
    useSceneStore.getState().addObject(makeDefaultKnotObject())
  }
}

/** Legacy metas from before the projects system (for first-boot migration). */
export function readLegacyMetas(): ObjectMeta[] | null {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_META_KEY) ?? 'null')
  } catch {
    return null
  }
}

export async function sweepOrphanBuffers(liveKeys: Set<string>) {
  try {
    for (const key of await idbKeys(STORES.buffers)) {
      if (!liveKeys.has(key)) await idbDelete(STORES.buffers, key)
    }
  } catch (e) {
    console.error('Failed to sweep orphan buffers', e)
  }
}

/** Wipes the CURRENT project's scene and rig back to a fresh single shape. */
export async function resetScene() {
  const emptyRig = makeEmptyRigSnapshot()
  useRigStore.setState({ ...emptyRig, playing: false, t: 0 })
  usePathStore.setState({
    paths: [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
    activePathId: CAMERA_PATH_ID,
    selectedAnchorId: null,
    selectedAnchorIds: [],
    selectedHandle: 'none',
    drawPlaneY: 1.2,
  })
  useCameraOptionsStore.getState().loadOptions(undefined, undefined, emptyRig)
  useSceneStore.setState({
    objects: [makeDefaultKnotObject()],
    bgColor: VIEWPORT_BG_DEFAULT_TOP,
    showGrid: true,
    lightIntensity: 1.4,
  })
  objectGraveyard.clear()
  const editor = useEditorStore.getState()
  editor.select(null)
  editor.setTool('select')
  editor.setCameraView(false)
  clearMeshRevisions()
  resetHistory()
  useSceneStore.getState().showNotice('Scene reset')
}
