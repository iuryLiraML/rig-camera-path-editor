import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  applyClay,
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
import { idbDelete, idbGet, idbKeys, STORES } from './idb'
import { resetHistory, historyClock, historyIsDirty } from './history'
import type { ModelKey } from './keyframes'
import { prepareImportedRoot } from './prepareImport'
import { VIEWPORT_BG_DEFAULT_TOP } from '../viewport/viewportBackground'
import { configureFal, falUsable } from './fal/client'
import { readFalSettings } from './fal/settings'
import { isGltfMeshBuffer } from './assetSniff'
import { countGltfTriangles } from './glbTriangleCount'
import { persistModelBuffer, readModelBytes } from './readModelFile'
import { makeDummyObject } from './dummyCharacter'
import { partitionDroppedSceneFiles } from './environment'
import { importEnvironmentFile } from './environmentJobs'

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

export function denseLoadParkCopy(name: string, triangles: number): string {
  return `"${name}" is dense (${formatTriangleCount(triangles)}). Remesh from the object bar.`
}

export function denseLoadParkManyCopy(count: number): string {
  return `${count} dense models loaded as placeholders. Remesh from the object bar.`
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

async function queueDenseRemesh(
  name: string,
  buffer: ArrayBuffer,
  triangles: number,
  scene: ReturnType<typeof useSceneStore.getState>,
): Promise<{
  objectId: string
  objectName: string
  byteSize: number
  triangles: number
} | null> {
  const decision = denseImportDecision(name, triangles, buffer.byteLength, falReady())
  if (decision.action !== 'remesh') {
    if (decision.action === 'skip') scene.showNotice(decision.notice)
    return null
  }
  const placeholder = addImportedObject(name, makeRemeshPlaceholderRoot(), [], triangles)
  try {
    await yieldToBrowser()
    buffer = await persistModelBuffer(placeholder.id, buffer)
    if (buffer.byteLength === 0) throw new Error('Persisted buffer was detached')
  } catch (error) {
    console.error('Failed to persist model buffer', error)
    scene.showNotice(`"${name}" imported, but remesh needs a re-import`)
    return {
      objectId: placeholder.id,
      objectName: placeholder.name,
      byteSize: buffer.byteLength,
      triangles,
    }
  }
  scene.showNotice(decision.notice)
  denseRemeshEnqueue?.(placeholder.id, buffer)
  return {
    objectId: placeholder.id,
    objectName: placeholder.name,
    byteSize: buffer.byteLength,
    triangles,
  }
}

export function disposeObject3D(root: THREE.Object3D) {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose()
  })
}

export const REMESH_PLACEHOLDER_FLAG = 'rigRemeshPlaceholder'

export function makeRemeshPlaceholderRoot(): THREE.Object3D {
  const group = new THREE.Group()
  group.userData[REMESH_PLACEHOLDER_FLAG] = true
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2))
  mesh.position.y = 0.6
  group.add(mesh)
  return group
}

export function isRemeshPlaceholder(root: THREE.Object3D): boolean {
  return root.userData[REMESH_PLACEHOLDER_FLAG] === true
}

export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    setTimeout(done, 0)
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(done)
  })
}

type ParkedMesh = { root: THREE.Object3D; clips: THREE.AnimationClip[] }
const parkedMeshes = new Map<string, ParkedMesh>()

/** Swap a live dense mesh for the remesh cube so the viewport stops drawing it. */
export function parkMeshForRemesh(objectId: string): boolean {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object || isRemeshPlaceholder(object.root)) return false
  if (parkedMeshes.has(objectId)) return true
  parkedMeshes.set(objectId, { root: object.root, clips: object.clips })
  useSceneStore.getState().replaceImportedRoot(objectId, makeRemeshPlaceholderRoot(), [])
  return true
}

function installParkedRoot(objectId: string, held: ParkedMesh): boolean {
  if (useSceneStore.getState().objects.some((item) => item.id === objectId)) {
    useSceneStore.getState().replaceImportedRoot(objectId, held.root, held.clips)
    return true
  }
  const buried = objectGraveyard.get(objectId)
  if (!buried) return false
  applyClay(held.root, buried.material)
  buried.root = held.root
  buried.clips = held.clips
  buried.primitive = undefined
  return true
}

export function restoreParkedMesh(objectId: string): boolean {
  const held = parkedMeshes.get(objectId)
  if (!held) return false
  parkedMeshes.delete(objectId)
  if (installParkedRoot(objectId, held)) return true
  disposeObject3D(held.root)
  return false
}

export function discardParkedMesh(objectId: string) {
  const held = parkedMeshes.get(objectId)
  if (!held) return
  parkedMeshes.delete(objectId)
  disposeObject3D(held.root)
}

export function clearParkedMeshesForTests() {
  for (const held of parkedMeshes.values()) disposeObject3D(held.root)
  parkedMeshes.clear()
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
  triangleCount?: number,
): SceneObject {
  const object = makeObject(name, root, { bufferKey: null, clips, triangleCount })
  object.bufferKey = object.id
  useSceneStore.getState().addObject(object)
  useEditorStore.getState().select(`obj:${object.id}`)
  return object
}

/** Imports GLB bytes as a new scene object and persists the buffer. */
export async function importModelBuffer(
  buffer: ArrayBuffer,
  name: string,
  opts: { announce?: boolean; autoRemesh?: boolean; triangles?: number | null } = {},
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
    if (!isGltfMeshBuffer(buffer)) {
      scene.showNotice(`"${name}" is not a GLB mesh.`)
      return null
    }
    const quickCount = opts.triangles !== undefined ? opts.triangles : countGltfTriangles(buffer)

    if (autoRemesh && quickCount != null && quickCount > RETOPO_TRIANGLES) {
      const queued = await queueDenseRemesh(name, buffer, quickCount, scene)
      if (queued) return queued
      return null
    }

    await yieldToBrowser()
    const { scene: root, clips } = await parseGLB(buffer)
    prepareImportedRoot(root)
    const triangles = quickCount ?? countTriangles(root)

    if (autoRemesh && triangles > RETOPO_TRIANGLES) {
      disposeObject3D(root)
      const queued = await queueDenseRemesh(name, buffer, triangles, scene)
      if (queued) return queued
      return null
    }

    normalizeModel(root)
    const object = addImportedObject(name, root, clips, triangles)

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
      await yieldToBrowser()
      await persistModelBuffer(object.id, buffer)
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
  useSceneStore.getState().setImporting(1)
  try {
    const { buffer, triangles } = await readModelBytes(file)
    return await importModelBuffer(buffer, name, { autoRemesh: true, triangles, ...opts })
  } catch (error) {
    console.error('Failed to read model file', error)
    useSceneStore.getState().showNotice('Could not read this file — use a self-contained .glb')
    return null
  } finally {
    useSceneStore.getState().setImporting(-1)
  }
}

const meshRevisions: { objectId: string; buffer: ArrayBuffer; clock: number }[] = []

export function objectTriangleCount(objectId: string): number {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object) return 0
  return object.triangleCount ?? countTriangles(object.root)
}

export function objectNeedsRetopo(objectId: string): boolean {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object?.bufferKey) return false
  const triangles = object.triangleCount ?? countTriangles(object.root)
  return triangles > RETOPO_TRIANGLES
}

export async function replaceImportedBuffer(
  objectId: string,
  buffer: ArrayBuffer,
  opts: { recordUndo?: boolean; previousBufferKey?: string; previousBuffer?: ArrayBuffer } = {},
): Promise<void> {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object?.bufferKey) throw new Error('Only imported models can be remeshed.')
  let previous: ArrayBuffer | undefined
  if (opts.recordUndo !== false) {
    previous = await idbGet<ArrayBuffer>(STORES.buffers, object.bufferKey)
    if (!previous && opts.previousBufferKey && opts.previousBufferKey !== object.bufferKey) {
      previous = await idbGet<ArrayBuffer>(STORES.buffers, opts.previousBufferKey)
    }
    if (!previous && opts.previousBuffer && opts.previousBuffer.byteLength > 0) {
      previous = opts.previousBuffer.slice(0)
    }
  }
  await yieldToBrowser()
  const { scene: root, clips } = await parseGLB(buffer)
  prepareImportedRoot(root)
  normalizeModel(root)
  useSceneStore.getState().replaceImportedRoot(objectId, root, clips)
  await yieldToBrowser()
  await persistModelBuffer(object.bufferKey, buffer)
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

/** Viewport / Import drop: GLB as clay, PLY/SPLAT as the scene palco (E19). */
export async function importDroppedSceneFiles(files: File[]): Promise<void> {
  const { models, environments } = partitionDroppedSceneFiles(files)
  if (models.length === 0 && environments.length === 0) {
    useSceneStore.getState().showNotice('Unsupported file — drop a .glb, .gltf, .ply or .splat')
    return
  }
  if (models.length > 0) await importDroppedModels(models)
  if (environments.length === 0) return
  if (environments.length > 1) {
    useSceneStore.getState().showNotice('One environment at a time — using the first file')
  }
  await importEnvironmentFile(environments[0])
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
  activeClip?: string
  follow?: FollowConfig
  triangleCount?: number
  rigKind?: import('./environment').RigKind
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
    activeClip: o.activeClip,
    follow: o.follow,
    triangleCount: o.triangleCount,
    rigKind: o.rigKind,
  }
}

export function liveSceneMetas(): ObjectMeta[] {
  return useSceneStore.getState().objects.map(toMeta)
}

export function denseLoadCanSkipBuffer(meta: ObjectMeta): boolean {
  return meta.triangleCount != null && meta.triangleCount > RETOPO_TRIANGLES
}

export function objectFromDenseMeta(meta: ObjectMeta): SceneObject {
  return makeObject(meta.name, makeRemeshPlaceholderRoot(), {
    ...meta,
    clips: [],
    triangleCount: meta.triangleCount,
  })
}

/** Rebuilds an imported object from its stored GLB. Dense meshes stay a cube. */
export async function objectFromStoredBuffer(meta: ObjectMeta, buffer: ArrayBuffer): Promise<SceneObject> {
  const triangles = countGltfTriangles(buffer) ?? meta.triangleCount
  if (triangles != null && triangles > RETOPO_TRIANGLES) {
    return makeObject(meta.name, makeRemeshPlaceholderRoot(), {
      ...meta,
      clips: [],
      triangleCount: triangles,
    })
  }
  await yieldToBrowser()
  const { scene: root, clips } = await parseGLB(buffer)
  prepareImportedRoot(root)
  normalizeModel(root)
  return makeObject(meta.name, root, {
    ...meta,
    clips,
    triangleCount: triangles ?? countTriangles(root),
  })
}

/** Clears the current scene and rebuilds it from metadata + stored buffers. */
export async function loadSceneFromMetas(metas: ObjectMeta[], seedIfEmpty = true) {
  objectGraveyard.clear()
  useSceneStore.setState({ objects: [] })
  const parked: { name: string; triangles: number }[] = []

  for (const meta of metas) {
    try {
      let object: SceneObject
      if (meta.primitive) {
        object = makePrimitive(meta.primitive.kind, { ...meta, params: meta.primitive.params })
        object.name = meta.name
      } else if (meta.rigKind === 'dummy') {
        object = makeDummyObject({
          id: meta.id,
          name: meta.name,
          shade: meta.shade,
          transform: meta.transform,
          keys: meta.keys,
          playClips: meta.playClips,
          activeClip: meta.activeClip,
        })
      } else if (meta.bufferKey === null) {
        object = makeDefaultKnotObject(meta)
        object.name = meta.name
      } else if (denseLoadCanSkipBuffer(meta)) {
        object = objectFromDenseMeta(meta)
        if (object.triangleCount != null) {
          parked.push({ name: object.name, triangles: object.triangleCount })
        }
      } else {
        const buffer = await idbGet<ArrayBuffer>(STORES.buffers, meta.bufferKey)
        if (!buffer) continue // buffer lost (cleared storage) — skip quietly
        object = await objectFromStoredBuffer(meta, buffer)
        if (isRemeshPlaceholder(object.root) && object.triangleCount != null) {
          parked.push({ name: object.name, triangles: object.triangleCount })
        }
        await yieldToBrowser()
      }
      useSceneStore.getState().addObject(object)
    } catch (e) {
      console.error('Failed to restore object', meta.name, e)
    }
  }

  if (parked.length === 1) {
    useSceneStore.getState().showNotice(denseLoadParkCopy(parked[0].name, parked[0].triangles))
  } else if (parked.length > 1) {
    useSceneStore.getState().showNotice(denseLoadParkManyCopy(parked.length))
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
