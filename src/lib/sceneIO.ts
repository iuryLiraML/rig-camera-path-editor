import * as THREE from 'three'
import {
  makeDefaultKnotObject,
  makeObject,
  makePrimitive,
  normalizeModel,
  objectGraveyard,
  disposeSceneObjectDisplays,
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
import {
  persistModelBuffer,
  readModelBytes,
  type ModelSourceFormat,
} from './readModelFile'
import { requestPersistFlush } from './persistFlush'
import { ensureDummyTemplate, makeDummyObject } from './dummyCharacter'
import { partitionDroppedSceneFiles } from './environment'
import { importEnvironmentFile } from './environmentJobs'
import {
  applyAssetDisplay,
  type AssetDisplayMode,
  type SourceMaterialMap,
} from './assetDisplay'
import { countRenderedTriangles } from './geometryStats'
import {
  estimateSourceTriangles,
  MODEL_FORMATS,
  modelFormatFromFilename,
  parseModelBuffer,
  type ModelFormat,
} from './modelCodec'

export { countObjTriangles } from './modelCodec'

/** legacy (pre-projects) localStorage key — still read for migration */
export const LEGACY_META_KEY = 'rig-scene-objects'
/** toast + remesh offer */
export const RETOPO_TRIANGLES = 80_000
/** stronger FPS copy in the import warning */
export const HEAVY_TRIANGLES = 1_500_000
/** Tripo remesh input cap (fal.ai mesh_url). */
export const FAL_REMESH_MAX_BYTES = 150 * 1024 * 1024

type DenseRemeshEnqueue = (
  objectId: string,
  buffer: ArrayBuffer,
  sourceFormat: ModelSourceFormat,
) => void
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
  return `"${name}" is dense (estimated source: ${formatTriangleCount(triangles)}). Remeshing with Tripo…`
}

export function denseRemeshNeedsKeyCopy(name: string, triangles: number): string {
  return `"${name}" is dense (estimated source: ${formatTriangleCount(triangles)}). Add a Fal key in Settings to remesh.`
}

export function remeshTooLargeCopy(name: string): string {
  return `"${name}" is too large to remesh (max 150 MB).`
}

export function denseLoadParkCopy(name: string, triangles: number): string {
  return `"${name}" is dense (estimated source: ${formatTriangleCount(triangles)}). Remesh from the object bar.`
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
  modelFormat: ModelFormat,
  scene: ReturnType<typeof useSceneStore.getState>,
  sourceFormat: ModelSourceFormat,
  skipNormalize = false,
): Promise<{
  objectId: string
  objectName: string
  byteSize: number
  triangles: number
} | null> {
  const decision = denseImportDecision(name, triangles, buffer.byteLength, falReady())
  if (decision.action === 'import') return null
  const placeholder = addImportedObject(
    name,
    makeRemeshPlaceholderRoot(),
    [],
    triangles,
    undefined,
    undefined,
    undefined,
    sourceFormat,
    modelFormat,
  )
  if (skipNormalize) markSkipNormalize(placeholder.root)
  let persisted = true
  try {
    await yieldToBrowser()
    buffer = await persistModelBuffer(placeholder.id, buffer)
    if (buffer.byteLength === 0) throw new Error('Persisted buffer was detached')
  } catch (error) {
    persisted = false
    console.error('Failed to persist model buffer', error)
    if (decision.action === 'skip') {
      await keepHighMesh(placeholder.id, buffer)
      scene.showNotice(`"${name}" kept as high mesh for this session — project storage is unavailable.`)
    }
  }
  if (decision.action === 'remesh') {
    scene.showNotice(
      persisted
        ? decision.notice
        : `"${name}" storage is unavailable. Remeshing from the in-memory source…`,
    )
    denseRemeshEnqueue?.(placeholder.id, buffer, sourceFormat)
  } else if (persisted) {
    scene.showNotice(decision.notice)
  }
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
export const SKIP_NORMALIZE_FLAG = 'rigSkipNormalize'

export function markSkipNormalize(root: THREE.Object3D) {
  root.userData[SKIP_NORMALIZE_FLAG] = true
}

export function shouldSkipNormalize(root: THREE.Object3D): boolean {
  return root.userData[SKIP_NORMALIZE_FLAG] === true
}

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

type ParkedMesh = {
  root: THREE.Object3D
  clips: THREE.AnimationClip[]
  sourceMaterials: SourceMaterialMap
}
const parkedMeshes = new Map<string, ParkedMesh>()

/** Swap a live dense mesh for the remesh cube so the viewport stops drawing it. */
export function parkMeshForRemesh(objectId: string): boolean {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object || isRemeshPlaceholder(object.root)) return false
  if (parkedMeshes.has(objectId)) return true
  parkedMeshes.set(objectId, {
    root: object.root,
    clips: object.clips,
    sourceMaterials: object.sourceMaterials,
  })
  const placeholder = makeRemeshPlaceholderRoot()
  if (shouldSkipNormalize(object.root)) markSkipNormalize(placeholder)
  useSceneStore.getState().replaceImportedRoot(objectId, placeholder, [])
  return true
}

function installParkedRoot(objectId: string, held: ParkedMesh): boolean {
  if (useSceneStore.getState().objects.some((item) => item.id === objectId)) {
    useSceneStore.getState().replaceImportedRoot(
      objectId,
      held.root,
      held.clips,
      held.sourceMaterials,
    )
    return true
  }
  const buried = objectGraveyard.get(objectId)
  if (!buried) return false
  buried.root = held.root
  buried.clips = held.clips
  buried.primitive = undefined
  buried.sourceMaterials = held.sourceMaterials
  applyAssetDisplay(buried, useEditorStore.getState().viewMode)
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

export function modelSourceFormatFromName(name: string): ModelSourceFormat | null {
  if (/\.obj$/i.test(name)) return 'obj'
  if (/\.gltf$/i.test(name)) return 'gltf'
  if (/\.glb$/i.test(name)) return 'glb'
  return null
}

export function modelFileDetails(format: ModelSourceFormat): {
  extension: ModelSourceFormat
  mime: string
} {
  if (format === 'obj') return { extension: 'obj', mime: 'text/plain' }
  if (format === 'gltf') return { extension: 'gltf', mime: 'model/gltf+json' }
  return { extension: 'glb', mime: 'model/gltf-binary' }
}

function countModelTriangles(buffer: ArrayBuffer, format: ModelSourceFormat): number | null {
  return estimateSourceTriangles(buffer, format === 'obj' ? 'obj' : 'gltf')
}

export function parseGlbBuffer(buffer: ArrayBuffer) {
  return parseModelBuffer(buffer, 'gltf')
}

export const countTriangles = countRenderedTriangles

function addImportedObject(
  name: string,
  root: THREE.Object3D,
  clips: THREE.AnimationClip[],
  triangleCount?: number,
  keepDenseMesh?: boolean,
  keepTexture?: boolean,
  keepPoints?: boolean,
  sourceFormat?: ModelSourceFormat,
  modelFormat: ModelFormat = sourceFormat === 'obj' ? 'obj' : 'gltf',
): SceneObject {
  const object = makeObject(name, root, {
    bufferKey: null,
    sourceFormat,
    modelFormat,
    clips,
    triangleCount,
    keepDenseMesh: keepDenseMesh || keepPoints,
    keepTexture,
    keepPoints,
  })
  object.bufferKey = object.id
  useSceneStore.getState().addObject(object)
  useEditorStore.getState().select(`obj:${object.id}`)
  return object
}

/** Imports model bytes as a new scene object and persists the buffer. */
export async function importModelBuffer(
  buffer: ArrayBuffer,
  name: string,
  opts: {
    announce?: boolean
    autoRemesh?: boolean
    triangles?: number | null
    normalize?: boolean
    keepDenseMesh?: boolean
    keepTexture?: boolean
    keepPoints?: boolean
    sourceFormat?: ModelSourceFormat
    modelFormat?: ModelFormat
  } = {},
): Promise<{
  objectId: string
  objectName: string
  byteSize: number
  triangles: number
} | null> {
  const announce = opts.announce ?? true
  const autoRemesh = opts.autoRemesh ?? false
  const normalize = opts.normalize ?? true
  const sourceFormat = opts.sourceFormat ?? 'glb'
  const modelFormat = opts.modelFormat ?? (sourceFormat === 'obj' ? 'obj' : 'gltf')
  const scene = useSceneStore.getState()
  scene.setImporting(1)
  try {
    if (!MODEL_FORMATS[modelFormat].accepts(buffer)) {
      scene.showNotice(`"${name}" is not a valid ${sourceFormat.toUpperCase()} mesh.`)
      return null
    }
    const quickCount =
      opts.triangles !== undefined ? opts.triangles : countModelTriangles(buffer, sourceFormat)

    if (autoRemesh && quickCount != null && quickCount > RETOPO_TRIANGLES) {
      const queued = await queueDenseRemesh(
        name,
        buffer,
        quickCount,
        modelFormat,
        scene,
        sourceFormat,
        !normalize,
      )
      if (queued) return queued
      return null
    }

    await yieldToBrowser()
    const { scene: root, clips } = await parseModelBuffer(buffer, modelFormat)
    prepareImportedRoot(root, { keepPoints: opts.keepPoints })
    const triangles = countRenderedTriangles(root)

    if (autoRemesh && triangles > RETOPO_TRIANGLES) {
      disposeObject3D(root)
      const queued = await queueDenseRemesh(
        name,
        buffer,
        triangles,
        modelFormat,
        scene,
        sourceFormat,
        !normalize,
      )
      if (queued) return queued
      return null
    }

    if (normalize) normalizeModel(root, { includePoints: opts.keepPoints })
    else markSkipNormalize(root)
    const object = addImportedObject(
      name,
      root,
      clips,
      triangles,
      opts.keepDenseMesh,
      opts.keepTexture,
      opts.keepPoints,
      sourceFormat,
      modelFormat,
    )

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
    scene.showNotice('Could not read this file — use a self-contained .glb, embedded .gltf, or geometry-only .obj')
    return null
  } finally {
    useSceneStore.getState().setImporting(-1)
  }
}

/** Imports a .glb/.gltf/.obj file as a new scene object and persists its buffer. */
export async function importModelFile(
  file: File,
  opts: { announce?: boolean; autoRemesh?: boolean } = {},
): Promise<{
  objectId: string
  objectName: string
  byteSize: number
  triangles: number
} | null> {
  const sourceFormat = modelSourceFormatFromName(file.name)
  if (!sourceFormat) {
    useSceneStore.getState().showNotice('Unsupported model — use .glb, .gltf or .obj')
    return null
  }
  const name = file.name.replace(/\.(glb|gltf|obj)$/i, '')
  useSceneStore.getState().setImporting(1)
  try {
    const { buffer, triangles } = await readModelBytes(file, sourceFormat)
    return await importModelBuffer(buffer, name, {
      autoRemesh: true,
      triangles,
      sourceFormat,
      modelFormat: modelFormatFromFilename(file.name),
      ...opts,
    })
  } catch (error) {
    console.error('Failed to read model file', error)
    useSceneStore.getState().showNotice(
      'Could not read this file — use a self-contained .glb, embedded .gltf, or geometry-only .obj',
    )
    return null
  } finally {
    useSceneStore.getState().setImporting(-1)
  }
}

const meshRevisions: { objectId: string; buffer: ArrayBuffer; clock: number }[] = []

export function objectTriangleCount(objectId: string): number {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object) return 0
  return object.triangleCount ?? countRenderedTriangles(object.root)
}

export function objectNeedsRetopo(objectId: string): boolean {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object?.bufferKey) return false
  if (object.keepPoints) return false
  const triangles = object.triangleCount ?? countRenderedTriangles(object.root)
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
  const { scene: root, clips } = await parseModelBuffer(buffer, 'gltf')
  prepareImportedRoot(root, { keepPoints: object.keepPoints })
  if (shouldSkipNormalize(object.root)) markSkipNormalize(root)
  else normalizeModel(root, { includePoints: object.keepPoints })
  const triangles = countRenderedTriangles(root)
  if (triangles <= 0 && !object.keepPoints) {
    disposeObject3D(root)
    throw new Error('Remesh returned an empty mesh. Retry from the object bar.')
  }
  // Validate and prepare before replacing the only persisted copy of the high mesh.
  await persistModelBuffer(object.bufferKey, buffer)
  useSceneStore.getState().replaceImportedRoot(objectId, root, clips, undefined, 'gltf')
  markObjectRemeshed(objectId, triangles)
  requestPersistFlush()
  if (previous) meshRevisions.push({ objectId, buffer: previous, clock: historyClock() })
}

function markObjectRemeshed(objectId: string, triangles: number) {
  useSceneStore.setState((s) => ({
    objects: s.objects.map((item) =>
      item.id === objectId
        ? {
            ...item,
            remeshed: true,
            sourceFormat: 'glb',
            modelFormat: 'gltf',
            triangleCount: triangles,
          }
        : item,
    ),
  }))
}

/** Loads the original dense GLB after a cancelled or failed auto-remesh. */
export async function keepHighMesh(
  objectId: string,
  sourceBuffer?: ArrayBuffer,
): Promise<{ persisted: boolean }> {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object?.bufferKey) throw new Error('The original high mesh is missing.')
  const buffer = sourceBuffer ?? (await idbGet<ArrayBuffer>(STORES.buffers, object.bufferKey))
  if (!buffer?.byteLength) throw new Error('The original high mesh is missing — re-import the model.')
  const sourceFormat = object.sourceFormat ?? (object.modelFormat === 'obj' ? 'obj' : 'glb')
  const modelFormat: ModelFormat = sourceFormat === 'obj' ? 'obj' : 'gltf'

  await yieldToBrowser()
  const { scene: root, clips } = await parseModelBuffer(buffer, modelFormat)
  prepareImportedRoot(root, { keepPoints: object.keepPoints })
  if (shouldSkipNormalize(object.root)) markSkipNormalize(root)
  else normalizeModel(root, { includePoints: object.keepPoints })
  const triangles = countModelTriangles(buffer, sourceFormat) ?? countTriangles(root)
  if (triangles <= 0 && !object.keepPoints) {
    disposeObject3D(root)
    throw new Error('The original high mesh could not be read.')
  }

  let persisted = true
  try {
    await persistModelBuffer(object.bufferKey, buffer)
  } catch (error) {
    persisted = false
    console.error('Failed to persist high mesh fallback', error)
  }
  useSceneStore.getState().replaceImportedRoot(objectId, root, clips, undefined, modelFormat)
  useSceneStore.setState((s) => ({
    objects: s.objects.map((item) =>
      item.id === objectId
        ? {
            ...item,
            keepDenseMesh: true,
            remeshed: false,
            triangleCount: triangles,
          }
        : item,
    ),
  }))
  requestPersistFlush()
  return { persisted }
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

/** Imports .glb/.gltf/.obj files; dense meshes auto-queue for Tripo remesh. */
export async function importDroppedModels(files: File[]): Promise<void> {
  const models = files.filter((file) => /\.(glb|gltf|obj)$/i.test(file.name))
  if (models.length === 0) {
    useSceneStore.getState().showNotice('Unsupported file — drop a .glb, .gltf, or .obj')
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

/** Viewport / Import drop: mesh as clay, PLY/SPLAT as the scene palco (E19). */
export async function importDroppedSceneFiles(files: File[]): Promise<void> {
  const { models, environments } = partitionDroppedSceneFiles(files)
  if (models.length === 0 && environments.length === 0) {
    useSceneStore.getState().showNotice('Unsupported file — drop a .glb, .gltf, .obj, .ply or .splat')
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
  sourceFormat?: ModelSourceFormat
  primitive?: PrimitiveSpec
  transform: Transform
  keys: ModelKey[]
  playClips: boolean
  activeClip?: string
  follow?: FollowConfig
  triangleCount?: number
  remeshed?: boolean
  modelFormat?: ModelFormat
  rigKind?: import('./environment').RigKind
  keepDenseMesh?: boolean
  keepTexture?: boolean
  keepPoints?: boolean
  bonePose?: Record<string, [number, number, number]>
  boneTranslate?: Record<string, [number, number, number]>
  figureSex?: 'female' | 'male'
  displayMode?: AssetDisplayMode
}

export function toMeta(o: SceneObject): ObjectMeta {
  return {
    id: o.id,
    name: o.name,
    shade: o.shade,
    bufferKey: o.bufferKey,
    sourceFormat: o.sourceFormat,
    primitive: o.primitive,
    transform: o.transform,
    keys: o.keys,
    playClips: o.playClips,
    activeClip: o.activeClip,
    follow: o.follow,
    triangleCount: o.triangleCount,
    remeshed: o.remeshed,
    modelFormat: o.modelFormat,
    rigKind: o.rigKind,
    keepDenseMesh: o.keepDenseMesh,
    keepTexture: o.keepTexture,
    keepPoints: o.keepPoints,
    bonePose: o.bonePose,
    boneTranslate: o.boneTranslate,
    figureSex: o.figureSex,
    displayMode: o.displayMode,
  }
}

export function liveSceneMetas(): ObjectMeta[] {
  return useSceneStore.getState().objects.map(toMeta)
}

export function denseLoadCanSkipBuffer(meta: ObjectMeta): boolean {
  if (meta.remeshed) return false
  if (meta.keepDenseMesh || meta.rigKind === 'sam-person' || meta.keepPoints) return false
  return meta.triangleCount != null && meta.triangleCount > RETOPO_TRIANGLES
}

export function objectFromDenseMeta(meta: ObjectMeta): SceneObject {
  return makeObject(meta.name, makeRemeshPlaceholderRoot(), {
    ...meta,
    clips: [],
    triangleCount: meta.triangleCount,
  })
}

/** Rebuilds an imported object from its stored model bytes. Dense meshes stay a cube. */
export async function objectFromStoredBuffer(meta: ObjectMeta, buffer: ArrayBuffer): Promise<SceneObject> {
  const sourceFormat = meta.sourceFormat ?? 'glb'
  const modelFormat = meta.modelFormat ?? (sourceFormat === 'obj' ? 'obj' : 'gltf')
  const triangles = countModelTriangles(buffer, sourceFormat) ?? meta.triangleCount
  if (
    !meta.remeshed &&
    !meta.keepDenseMesh &&
    meta.rigKind !== 'sam-person' &&
    !meta.keepPoints &&
    triangles != null &&
    triangles > RETOPO_TRIANGLES
  ) {
    return makeObject(meta.name, makeRemeshPlaceholderRoot(), {
      ...meta,
      clips: [],
      triangleCount: triangles,
    })
  }
  await yieldToBrowser()
  const { scene: root, clips } = await parseModelBuffer(buffer, modelFormat)
  prepareImportedRoot(root, { keepPoints: meta.keepPoints })
  normalizeModel(root, { includePoints: meta.keepPoints })
  return makeObject(meta.name, root, {
    ...meta,
    clips,
    triangleCount: countRenderedTriangles(root),
  })
}

/** Replaces a dense placeholder with its source before topology inspection. */
export async function installHighMeshBuffer(objectId: string, buffer: ArrayBuffer): Promise<boolean> {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object?.bufferKey || !isRemeshPlaceholder(object.root)) return false
  await keepHighMesh(objectId, buffer)
  return true
}

/** Clears the current scene and rebuilds it from metadata + stored buffers. */
export async function loadSceneFromMetas(metas: ObjectMeta[], seedIfEmpty = true) {
  disposeSceneObjectDisplays(useSceneStore.getState().objects)
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
        await ensureDummyTemplate(meta.figureSex ?? 'male')
        object = makeDummyObject({
          id: meta.id,
          name: meta.name,
          shade: meta.shade,
          transform: meta.transform,
          keys: meta.keys,
          playClips: meta.playClips,
          activeClip: meta.activeClip,
          bonePose: meta.bonePose,
          boneTranslate: meta.boneTranslate,
          figureSex: meta.figureSex ?? 'male',
          displayMode: meta.displayMode,
          triangleCount: meta.triangleCount,
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
  disposeSceneObjectDisplays(useSceneStore.getState().objects)
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
