import { create } from 'zustand'
import { idbDelete, idbGet, idbGetAll, idbPut, STORES } from './idb'
import { persistModelBuffer } from './readModelFile'
import { environmentFileKind, type EnvironmentSource } from './environment'
import { assertGaussianSplat, isGltfMeshBuffer } from './assetSniff'
import { clayThumbForBuffer } from './assetThumb'
import { countObjTriangles } from './objTriangleCount'
import { createPlan, planActions, planToJSON, type StoredPlan } from './floorPlanModel'
import { makeSceneId, makePlanObject } from '../state/useSceneStore'
import { makeEnvironmentId, useEnvironmentStore } from '../state/useEnvironmentStore'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { createProject } from './projects'
import { useSceneStore } from '../state/useSceneStore'

export const LOCAL_LIBRARY_OWNER = 'local'

export type LibraryAssetKind = 'location' | 'model' | 'plan'
export type LibraryAssetFormat = 'ply' | 'splat' | 'glb' | 'gltf' | 'obj' | 'plan'

export type LibraryAsset = {
  id: string
  name: string
  kind: LibraryAssetKind
  /** Key into the buffers store. Null for a Plan, which stores its wall graph instead of mesh bytes. */
  bufferKey: string | null
  source: EnvironmentSource
  format: LibraryAssetFormat
  createdAt: number
  ownerId: string
  thumbnail?: Blob
  collectionId: string | null
  tags: string[]
  /** A Plan's wall graph. Absent on Location and Model, which hold bytes instead. */
  plan?: StoredPlan
}

export type LibraryCollection = {
  id: string
  name: string
  createdAt: number
  ownerId: string
}

/** Sidebar/filter state: which slice of the shelf the grid shows. */
export type LibraryFilters = {
  collectionId: 'all' | 'unfiled' | string
  kind: 'all' | LibraryAssetKind
  tag: string | null
  query: string
}

const DEFAULT_FILTERS: LibraryFilters = { collectionId: 'all', kind: 'all', tag: null, query: '' }

interface LibraryState {
  assets: LibraryAsset[]
  collections: LibraryCollection[]
  selectedId: string | null
  filters: LibraryFilters
  setAssets: (assets: LibraryAsset[]) => void
  setCollections: (collections: LibraryCollection[]) => void
  setSelectedId: (id: string | null) => void
  setFilters: (patch: Partial<LibraryFilters>) => void
}

export const useLibraryStore = create<LibraryState>((set) => ({
  assets: [],
  collections: [],
  selectedId: null,
  filters: DEFAULT_FILTERS,
  setAssets: (assets) => set({ assets }),
  setCollections: (collections) => set({ collections }),
  setSelectedId: (selectedId) => set({ selectedId }),
  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
}))

export function libraryOwnerId(): string {
  return useCloudAuthStore.getState().session?.userId ?? LOCAL_LIBRARY_OWNER
}

export function libraryBufferKeys(): Set<string> {
  const keys = new Set<string>()
  for (const asset of useLibraryStore.getState().assets) {
    // A Plan owns no buffer; a null key must not leak into the orphan sweep's keep-set.
    if (asset.bufferKey) keys.add(asset.bufferKey)
  }
  return keys
}

export function libraryAssetById(id: string | null | undefined): LibraryAsset | undefined {
  if (!id) return undefined
  return useLibraryStore.getState().assets.find((item) => item.id === id)
}

export async function resolveLibraryAsset(id: string | null | undefined): Promise<LibraryAsset | undefined> {
  if (!id) return undefined
  return libraryAssetById(id) ?? (await listLibraryAssets()).find((item) => item.id === id)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Letter-and-name still so Library cards match Projects tiles. */
export async function makeLibraryStill(name: string): Promise<Blob> {
  const label = name.trim() || 'Asset'
  const letter = label.charAt(0).toUpperCase()
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 360
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#16161a'
      ctx.fillRect(0, 0, 640, 360)
      ctx.fillStyle = '#6e6e76'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '700 72px sans-serif'
      ctx.fillText(letter, 320, 155)
      ctx.font = '20px sans-serif'
      ctx.fillText(label.slice(0, 32), 320, 240)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (blob) return blob
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#16161a"/><text x="320" y="175" fill="#6e6e76" font-size="72" font-family="sans-serif" font-weight="700" text-anchor="middle">${escapeXml(letter)}</text><text x="320" y="250" fill="#6e6e76" font-size="20" font-family="sans-serif" text-anchor="middle">${escapeXml(label.slice(0, 32))}</text></svg>`
  return new Blob([svg], { type: 'image/svg+xml' })
}

/** v6 records predate collections/tags and called the location kind "environment". */
function normalizeAsset(record: Partial<LibraryAsset> & { kind?: string }): LibraryAsset {
  return {
    ...record,
    kind: record.kind === 'model' ? 'model' : record.kind === 'plan' ? 'plan' : 'location',
    collectionId: record.collectionId ?? null,
    tags: Array.isArray(record.tags) ? record.tags : [],
  } as LibraryAsset
}

function owned(assets: LibraryAsset[]): LibraryAsset[] {
  const ownerId = libraryOwnerId()
  return assets.filter((item) => item.ownerId === ownerId)
}

export async function listLibraryAssets(): Promise<LibraryAsset[]> {
  const all = await idbGetAll<Partial<LibraryAsset> & { kind?: string }>(STORES.library)
  const assets = owned(all.map(normalizeAsset)).sort((a, b) => b.createdAt - a.createdAt)
  useLibraryStore.getState().setAssets(assets)
  return assets
}

// ---------------------------------------------------------------------------
// Collections — flat folders; an asset lives in at most one (D2)
// ---------------------------------------------------------------------------

export async function listLibraryCollections(): Promise<LibraryCollection[]> {
  const all = await idbGetAll<LibraryCollection>(STORES.collections)
  const ownerId = libraryOwnerId()
  const collections = all
    .filter((item) => item.ownerId === ownerId)
    .sort((a, b) => a.createdAt - b.createdAt)
  useLibraryStore.getState().setCollections(collections)
  return collections
}

export async function createLibraryCollection(name: string): Promise<string | null> {
  const trimmed = name.trim()
  if (!trimmed) {
    useSceneStore.getState().showNotice('Give the collection a name')
    return null
  }
  const collection: LibraryCollection = {
    id: makeSceneId('collection'),
    name: trimmed,
    createdAt: Date.now(),
    ownerId: libraryOwnerId(),
  }
  await idbPut(STORES.collections, collection)
  await listLibraryCollections()
  return collection.id
}

export async function renameLibraryCollection(collectionId: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) {
    useSceneStore.getState().showNotice('Give the collection a name')
    return
  }
  const existing = await idbGet<LibraryCollection>(STORES.collections, collectionId)
  if (!existing) return
  await idbPut(STORES.collections, { ...existing, name: trimmed })
  await listLibraryCollections()
}

/** Deleting a collection never deletes assets — they return to Unfiled (D2). */
export async function deleteLibraryCollection(collectionId: string): Promise<void> {
  const assets = await listLibraryAssets()
  for (const asset of assets) {
    if (asset.collectionId === collectionId) {
      await idbPut(STORES.library, { ...asset, collectionId: null })
    }
  }
  await idbDelete(STORES.collections, collectionId)
  const state = useLibraryStore.getState()
  if (state.filters.collectionId === collectionId) state.setFilters({ collectionId: 'all' })
  await Promise.all([listLibraryAssets(), listLibraryCollections()])
}

export async function assignAssetToCollection(assetId: string, collectionId: string | null): Promise<void> {
  const asset = await resolveLibraryAsset(assetId)
  if (!asset) return
  await idbPut(STORES.library, { ...asset, collectionId })
  await listLibraryAssets()
}

// ---------------------------------------------------------------------------
// Tags — free-form, normalized on write (D3)
// ---------------------------------------------------------------------------

export function normalizeAssetTag(tag: string): string {
  return tag.trim().toLowerCase()
}

export async function addAssetTag(assetId: string, tag: string): Promise<void> {
  const normalized = normalizeAssetTag(tag)
  if (!normalized) return
  const asset = await resolveLibraryAsset(assetId)
  if (!asset || asset.tags.includes(normalized)) return
  await idbPut(STORES.library, { ...asset, tags: [...asset.tags, normalized] })
  await listLibraryAssets()
}

export async function removeAssetTag(assetId: string, tag: string): Promise<void> {
  const normalized = normalizeAssetTag(tag)
  const asset = await resolveLibraryAsset(assetId)
  if (!asset) return
  await idbPut(STORES.library, { ...asset, tags: asset.tags.filter((item) => item !== normalized) })
  await listLibraryAssets()
}

export function libraryAssetFileKind(name: string): LibraryAssetKind | null {
  if (environmentFileKind(name)) return 'location'
  if (/\.(glb|gltf|obj)$/i.test(name)) return 'model'
  return null
}

// ---------------------------------------------------------------------------
// Plans — a wall graph, not mesh bytes (ADR 0003). bufferKey stays null.
// ---------------------------------------------------------------------------

/** Create a Plan asset with an editable 4 × 4 m room and return its id. Lands in the viewed collection, untagged (FR-006). */
export async function createPlanAsset(collectionId: string | null = null): Promise<string> {
  const id = makeSceneId('plan')
  const starter = createPlan()
  planActions.stampRectangle(starter, { x: 0, y: 0 }, { x: 4, y: 4 })
  const { walls, openings } = planToJSON(starter)
  const asset: LibraryAsset = {
    id,
    name: 'Untitled plan',
    kind: 'plan',
    bufferKey: null,
    source: 'import',
    format: 'plan',
    createdAt: Date.now(),
    ownerId: libraryOwnerId(),
    collectionId,
    tags: [],
    plan: { walls, openings },
  }
  await idbPut(STORES.library, asset)
  await listLibraryAssets()
  useLibraryStore.getState().setSelectedId(id)
  return id
}

// Thumbnail rendering is asynchronous; serialize writes so Save cannot restore an older title.
const planWrites = new Map<string, Promise<void>>()
function writePlan(assetId: string, write: () => Promise<void>): Promise<void> {
  const previous = planWrites.get(assetId) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(write)
  planWrites.set(assetId, next)
  void next.finally(() => { if (planWrites.get(assetId) === next) planWrites.delete(assetId) }).catch(() => {})
  return next
}

/** Persist the plan's wall graph onto its asset record, and refresh its clay
 *  thumbnail from the extrusion so the card reflects the edit (FR-007). */
export async function savePlanAsset(assetId: string, plan: StoredPlan): Promise<void> {
  return writePlan(assetId, async () => {
    const asset = await resolveLibraryAsset(assetId)
    if (!asset || asset.kind !== 'plan') return
    const thumbnail = await makePlanThumbnail(plan, asset.name)
    await idbPut(STORES.library, { ...asset, plan, ...(thumbnail ? { thumbnail } : {}) })
    await listLibraryAssets()
  })
}

/** A clay render of the plan's extrusion, falling back to the letter still. */
async function makePlanThumbnail(plan: StoredPlan, name: string): Promise<Blob | undefined> {
  try {
    const { renderPlanThumb } = await import('./planThumb')
    const dataUrl = await renderPlanThumb(plan)
    if (dataUrl) return await dataUrlToBlob(dataUrl)
  } catch {
    // fall through to the letter still
  }
  return makeLibraryStill(name)
}

/** Rename a plan from the editor's title chip. */
export async function renamePlanAsset(assetId: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  return writePlan(assetId, async () => {
    const asset = await resolveLibraryAsset(assetId)
    if (!asset) return
    await idbPut(STORES.library, { ...asset, name: trimmed })
    await listLibraryAssets()
  })
}

/**
 * Insert a Plan as one clay object carrying a copy of its wall graph. An empty
 * plan refuses rather than adding an invisible object. With no project open,
 * create one named after the plan so the action always lands somewhere.
 */
async function insertPlanIntoScene(asset: LibraryAsset): Promise<string | null> {
  const plan = asset.plan
  if (!plan || !plan.walls.length) {
    useSceneStore.getState().showNotice('That plan has no walls yet — draw a room first')
    return null
  }
  // Static import: a dynamic import here would resolve a second, timestamped
  // module instance whose useSceneStore is not the one the scene renders.
  const object = makePlanObject(asset.name, plan)
  if (!useProjectStore.getState().projectId) {
    // createProject clears the scene as it bootstraps; add the plan after it.
    await createProject(asset.name)
  }
  useSceneStore.getState().addObject(object)
  const editor = useEditorStore.getState()
  editor.setAppView('editor')
  editor.setWorkspaceMode('build')
  useSceneStore.getState().showNotice(`${asset.name} inserted into the scene`)
  return object.id
}

const MODEL_FORMAT = /\.(glb|gltf|obj)$/i

async function dataUrlToBlob(dataUrl: string): Promise<Blob | undefined> {
  try {
    return await (await fetch(dataUrl)).blob()
  } catch {
    return undefined
  }
}

/** Clay render for GLB/GLTF; OBJ and test runs fall back to the letter-still. */
async function makeModelThumbnail(bufferKey: string, name: string): Promise<Blob> {
  const dataUrl = await clayThumbForBuffer(bufferKey).catch(() => null)
  if (dataUrl) {
    const blob = await dataUrlToBlob(dataUrl)
    if (blob) return blob
  }
  return makeLibraryStill(name)
}

export async function importLibraryAsset(file: File, collectionId: string | null = null, options: { navigate?: boolean } = {}): Promise<string | null> {
  const kind = libraryAssetFileKind(file.name)
  if (!kind) {
    useSceneStore.getState().showNotice('Import accepts .ply, .splat, .glb, .gltf or .obj')
    return null
  }
  try {
    const buffer = await file.arrayBuffer()
    // Validate fully before persisting anything; if the record write fails
    // after the bytes landed, the buffer is deleted — a failed import leaves
    // nothing behind.
    let format: LibraryAssetFormat
    if (kind === 'location') {
      format = assertGaussianSplat(buffer, file.name)
    } else {
      format = file.name.match(MODEL_FORMAT)![1].toLowerCase() as 'glb' | 'gltf' | 'obj'
      // Shelf bytes are inert: triangle-density and remesh decisions fire at
      // insert via importModelFile, not at import.
      if (format === 'obj' && !countObjTriangles(buffer)) {
        throw new Error('That OBJ has no triangles the viewport can load.')
      }
      if (format !== 'obj' && !isGltfMeshBuffer(buffer)) {
        throw new Error('That file is not a GLB mesh. Gaussian splats import as Locations (.ply/.splat).')
      }
    }
    const id = kind === 'location' ? makeEnvironmentId() : makeSceneId('asset')
    const name = file.name.replace(/\.(ply|splat|glb|gltf|obj)$/i, '') || (kind === 'location' ? 'Location' : 'Model')
    try {
      await persistModelBuffer(id, buffer)
      const asset: LibraryAsset = {
        id,
        name,
        kind,
        bufferKey: id,
        source: 'import',
        format,
        createdAt: Date.now(),
        ownerId: libraryOwnerId(),
        thumbnail: kind === 'model' ? await makeModelThumbnail(id, name) : await makeLibraryStill(name),
        collectionId,
        tags: [],
      }
      await idbPut(STORES.library, asset)
    } catch (error) {
      await idbDelete(STORES.buffers, id).catch(() => undefined)
      throw error
    }
    await listLibraryAssets()
    useLibraryStore.getState().setSelectedId(id)
    if (options.navigate !== false) useEditorStore.getState().setAppView('library')
    return id
  } catch (error) {
    useSceneStore.getState().showNotice(error instanceof Error ? error.message : 'Asset import failed')
    return null
  }
}

function linkedProjectCount(records: { scenes?: { environmentId?: string | null }[] }[], assetId: string): number {
  return records.filter((record) => (record.scenes ?? []).some((scene) => scene.environmentId === assetId)).length
}

export function libraryDeleteMessage(count: number): string | null {
  if (count <= 0) return null
  return count === 1 ? 'Used in 1 project' : `Used in ${count} projects`
}

export async function deleteLibraryAsset(assetId: string): Promise<string | null> {
  const records = await idbGetAll<{ scenes?: { environmentId?: string | null }[] }>(STORES.projects)
  const blocked = libraryDeleteMessage(linkedProjectCount(records, assetId))
  if (blocked) {
    useSceneStore.getState().showNotice(blocked)
    return blocked
  }
  const asset = await resolveLibraryAsset(assetId)
  await idbDelete(STORES.library, assetId)
  // A Plan has no buffer; deleting one would pass null to IDB.
  if (asset?.bufferKey) await idbDelete(STORES.buffers, asset.bufferKey)
  const next = await listLibraryAssets()
  const selected = useLibraryStore.getState().selectedId
  if (selected === assetId) {
    useLibraryStore.getState().setSelectedId(next[0]?.id ?? null)
  }
  return null
}

export async function createProjectFromAsset(assetId: string): Promise<string | null> {
  const asset = await resolveLibraryAsset(assetId)
  if (!asset) {
    useSceneStore.getState().showNotice('That Library item could not be found')
    return null
  }
  if (asset.kind !== 'location') {
    useSceneStore.getState().showNotice('Only a Location can be the scene environment')
    return null
  }  const { createProject, saveActiveProject } = await import('./projects')
  const projectId = await createProject(asset.name)
  const activeSceneId = useProjectStore.getState().activeSceneId
  useEnvironmentStore.getState().hydrate({
    environments: [],
    unplacedAssets: [],
    sceneBindings: activeSceneId ? [{ id: activeSceneId, environmentId: asset.id }] : [],
    environmentId: asset.id,
  })
  // A location always has bytes; the kind check above guarantees it. The guard is for the type.
  const buffer = asset.bufferKey ? await idbGet<ArrayBuffer>(STORES.buffers, asset.bufferKey) : undefined
  useEnvironmentStore.getState().setLiveBuffer(buffer ?? null, asset.format as 'ply' | 'splat')
  await saveActiveProject()
  const editor = useEditorStore.getState()
  editor.setAppView('editor')
  editor.setWorkspaceMode('build')
  return projectId
}

/**
 * Place a Model into the active scene through the same path as a dropped file.
 * With no project open, create one first so the action always lands somewhere.
 */
export async function insertLibraryAssetIntoScene(assetId: string): Promise<string | null> {
  const asset = await resolveLibraryAsset(assetId)
  if (!asset) {
    useSceneStore.getState().showNotice('That Library item could not be found')
    return null
  }
  // A Plan inserts as one clay object built from its wall graph — never through
  // the mesh-import path, because a Plan owns no bytes (ADR 0003).
  if (asset.kind === 'plan') {
    return insertPlanIntoScene(asset)
  }
  if (asset.kind !== 'model') {
    useSceneStore.getState().showNotice('Only a Model can be inserted as an object')
    return null
  }
  const buffer = asset.bufferKey ? await idbGet<ArrayBuffer>(STORES.buffers, asset.bufferKey) : undefined
  if (!buffer) {
    useSceneStore.getState().showNotice('That asset’s bytes are missing from this browser')
    return null
  }
  if (!useProjectStore.getState().projectId) {
    const { createProject } = await import('./projects')
    await createProject(asset.name)
  }
  const { importModelFile } = await import('./sceneIO')
  const imported = await importModelFile(new File([buffer], `${asset.name}.${asset.format}`), { announce: true })
  if (!imported) return null
  const editor = useEditorStore.getState()
  editor.setAppView('editor')
  editor.setWorkspaceMode('build')
  return imported.objectId
}
