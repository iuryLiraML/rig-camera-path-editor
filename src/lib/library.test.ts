// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as THREE from 'three'
import { makeFixtureSplatPly } from './environment'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { useEditorStore } from '../state/useEditorStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { useProjectStore } from '../state/useProjectStore'
import { useSceneStore } from '../state/useSceneStore'

const palcos = new Map<string, unknown>()
const collections = new Map<string, unknown>()
const buffers = new Map<string, ArrayBuffer>()
const projects = new Map<string, { id: string; scenes: { environmentId?: string | null }[] }>()
let failNextLibraryPut = false

vi.mock('./idb', () => ({
  STORES: {
    buffers: 'model-buffers',
    projects: 'projects',
    folders: 'folders',
    assetThumbs: 'asset-thumbs',
    library: 'library-palcos',
    collections: 'library-collections',
  },
  idbPut: vi.fn(async (store: string, value: unknown, key?: string) => {
    if (store === 'library-palcos') {
      if (failNextLibraryPut) {
        failNextLibraryPut = false
        throw new Error('IndexedDB quota exceeded')
      }
      const record = value as { id: string }
      palcos.set(record.id, value)
      return
    }
    if (store === 'library-collections') {
      const record = value as { id: string }
      collections.set(record.id, value)
      return
    }
    if (store === 'model-buffers' && typeof key === 'string') {
      buffers.set(key, value as ArrayBuffer)
    }
    if (store === 'projects') {
      const record = value as { id: string; scenes: { environmentId?: string | null }[] }
      projects.set(record.id, record)
    }
  }),
  idbGet: vi.fn(async (store: string, key: string) => {
    if (store === 'library-palcos') return palcos.get(key)
    if (store === 'library-collections') return collections.get(key)
    if (store === 'model-buffers') return buffers.get(key)
    if (store === 'projects') return projects.get(key)
    return undefined
  }),
  idbGetAll: vi.fn(async (store: string) => {
    if (store === 'library-palcos') return [...palcos.values()]
    if (store === 'library-collections') return [...collections.values()]
    if (store === 'projects') return [...projects.values()]
    return []
  }),
  idbDelete: vi.fn(async (store: string, key: string) => {
    if (store === 'library-palcos') palcos.delete(key)
    if (store === 'library-collections') collections.delete(key)
    if (store === 'model-buffers') buffers.delete(key)
  }),
}))

vi.mock('./projects', () => ({
  createProject: vi.fn(async (name: string) => {
    const id = `proj-${name.replace(/\s+/g, '-').toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`
    useProjectStore.setState({
      projectId: id,
      name,
      activeSceneId: 'scene-1',
      scenes: [{ id: 'scene-1', name: 'Scene 1' }],
    })
    useSceneStore.setState({ objects: [] })
    useEditorStore.getState().setAppView('editor')
    useEditorStore.getState().setWorkspaceMode('build')
    return id
  }),
  saveActiveProject: vi.fn(async () => undefined),
}))

const importModelFileMock = vi.fn(async (file: File, _opts?: { announce?: boolean }) => ({
  objectId: 'obj-1',
  objectName: file.name.replace(/\.[^.]+$/, ''),
  byteSize: file.size,
  triangles: 1,
}))

vi.mock('./sceneIO', () => ({
  importModelFile: (file: File, opts?: { announce?: boolean }) => importModelFileMock(file, opts),
}))

import {
  LOCAL_LIBRARY_OWNER,
  addAssetTag,
  assignAssetToCollection,
  createLibraryCollection,
  createPlanAsset,
  createProjectFromAsset,
  deleteLibraryAsset,
  deleteLibraryCollection,
  importLibraryAsset,
  insertLibraryAssetIntoScene,
  libraryBufferKeys,
  listLibraryAssets,
  listLibraryCollections,
  removeAssetTag,
  renameLibraryCollection,
  renamePlanAsset,
  resolveLibraryAsset,
  savePlanAsset,
  useLibraryStore,
} from './library'

function plyFile(name = 'Beach.ply') {
  return new File([makeFixtureSplatPly()], name, { type: 'application/octet-stream' })
}

beforeEach(() => {
  palcos.clear()
  collections.clear()
  buffers.clear()
  projects.clear()
  importModelFileMock.mockClear()
  useLibraryStore.setState({ assets: [], collections: [], selectedId: null })
  useCloudAuthStore.setState({ session: null, status: 'signed-out' })
  useEditorStore.setState({ appView: 'library', workspaceMode: 'build' })
  useProjectStore.setState({ projectId: '', scenes: [] })
  useEnvironmentStore.getState().hydrate({ environments: [], unplacedAssets: [], environmentId: null })
  useSceneStore.setState({ objects: [], notice: null })
})

afterEach(() => {
  palcos.clear()
  collections.clear()
  buffers.clear()
  projects.clear()
})

describe('legacy records', () => {
  it('normalizes a v6 palco record on read', async () => {
    palcos.set('env-legacy', {
      id: 'env-legacy',
      name: 'Old Beach',
      kind: 'environment',
      bufferKey: 'env-legacy',
      source: 'import',
      format: 'ply',
      createdAt: 1,
      ownerId: LOCAL_LIBRARY_OWNER,
    })
    const listed = await listLibraryAssets()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      id: 'env-legacy',
      kind: 'location',
      collectionId: null,
      tags: [],
    })
  })
})

describe('importLibraryAsset', () => {
  it('stores an asset on the Account Library without an open project', async () => {
    expect(useProjectStore.getState().projectId).toBe('')
    const id = await importLibraryAsset(plyFile())
    expect(id).toMatch(/^env/)
    const listed = await listLibraryAssets()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.name).toBe('Beach')
    expect(listed[0]?.ownerId).toBe(LOCAL_LIBRARY_OWNER)
    expect(listed[0]?.format).toBe('ply')
    expect(listed[0]?.thumbnail).toBeInstanceOf(Blob)
    expect(useLibraryStore.getState().selectedId).toBe(id)
    expect(useEditorStore.getState().appView).toBe('library')
    expect(useEnvironmentStore.getState().environments).toHaveLength(0)
  })

  it('refuses an unsupported extension and leaves the Library unchanged', async () => {
    const notes = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const id = await importLibraryAsset(notes)
    expect(id).toBeNull()
    expect(await listLibraryAssets()).toEqual([])
    expect(useSceneStore.getState().notice).toMatch(/\.ply, \.splat, \.glb, \.gltf or \.obj/i)
  })

  it('stores a GLB as a Model asset with a thumbnail', async () => {
    const glb = new File([new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0])], 'Chair.glb', {
      type: 'model/gltf-binary',
    })
    const id = await importLibraryAsset(glb)
    expect(id).toBeTruthy()
    const listed = await listLibraryAssets()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.name).toBe('Chair')
    expect(listed[0]?.kind).toBe('model')
    expect(listed[0]?.format).toBe('glb')
    expect(listed[0]?.collectionId).toBeNull()
    expect(listed[0]?.tags).toEqual([])
    expect(listed[0]?.thumbnail).toBeInstanceOf(Blob)
  })

  it('stores an OBJ as a Model asset', async () => {
    const obj = new File(['v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'], 'Rock.obj', {
      type: 'text/plain',
    })
    const id = await importLibraryAsset(obj)
    expect(id).toBeTruthy()
    const listed = await listLibraryAssets()
    expect(listed[0]?.kind).toBe('model')
    expect(listed[0]?.format).toBe('obj')
  })

  it('refuses a splat renamed as .glb with a clear notice', async () => {
    const fake = new File([makeFixtureSplatPly()], 'Beach.glb')
    const id = await importLibraryAsset(fake)
    expect(id).toBeNull()
    expect(await listLibraryAssets()).toEqual([])
    expect(useSceneStore.getState().notice).toMatch(/not a GLB mesh|Gaussian splat/i)
  })

  it('refuses an OBJ with no triangles', async () => {
    const garbage = new File(['# just a comment\n'], 'empty.obj', { type: 'text/plain' })
    const id = await importLibraryAsset(garbage)
    expect(id).toBeNull()
    expect(await listLibraryAssets()).toEqual([])
    expect(useSceneStore.getState().notice).toMatch(/no triangles/i)
  })

  it('a refused import persists no buffer bytes', async () => {
    const ascii = new File(['ply\nformat ascii 1.0\nelement vertex 0\nend_header\n'], 'bad.ply')
    const id = await importLibraryAsset(ascii)
    expect(id).toBeNull()
    expect(buffers.size).toBe(0)
  })

  it('deletes the buffer when the record write fails after persisting', async () => {
    failNextLibraryPut = true
    const id = await importLibraryAsset(plyFile())
    expect(id).toBeNull()
    expect(useSceneStore.getState().notice).toMatch(/quota/i)
    expect(buffers.size).toBe(0)
    expect(await listLibraryAssets()).toEqual([])
  })

  it('does not show another Account’s palcos', async () => {
    await importLibraryAsset(plyFile('Mine.ply'))
    useCloudAuthStore.setState({
      status: 'signed-in',
      session: { userId: 'google-sub-b', tenantId: 't', email: null, name: null, picture: null },
    })
    expect(await listLibraryAssets()).toEqual([])
  })
})

describe('createProjectFromAsset', () => {
  it('opens Build with the palco linked and no clay objects', async () => {
    const palcoId = await importLibraryAsset(plyFile())
    expect(palcoId).toBeTruthy()
    const projectId = await createProjectFromAsset(palcoId!)
    expect(projectId).toBeTruthy()
    expect(useEditorStore.getState().appView).toBe('editor')
    expect(useEditorStore.getState().workspaceMode).toBe('build')
    expect(useEnvironmentStore.getState().environmentId).toBe(palcoId)
    expect(useSceneStore.getState().objects).toHaveLength(0)
    expect(useEnvironmentStore.getState().environments).toEqual([])
    expect(useEnvironmentStore.getState().environmentId).toBe(palcoId)
    expect(await listLibraryAssets()).toHaveLength(1)
  })

  it('resolves Library bytes before a stale project copy of the same id', async () => {
    const palcoId = await importLibraryAsset(plyFile())
    const palco = (await listLibraryAssets())[0]!
    const libraryBytes = buffers.get(palco.bufferKey!)!
    buffers.set('stale-copy', new ArrayBuffer(8))
    useEnvironmentStore.getState().hydrate({
      environments: [
        {
          id: palco.id,
          name: 'Stale copy',
          bufferKey: 'stale-copy',
          source: 'import',
          format: 'ply',
          createdAt: 1,
        },
      ],
      unplacedAssets: [],
      environmentId: palco.id,
    })
    const { loadLiveEnvironmentBuffer } = await import('./environmentJobs')
    await loadLiveEnvironmentBuffer()
    expect(useEnvironmentStore.getState().liveBuffer?.byteLength).toBe(libraryBytes.byteLength)
    expect(palcoId).toBe(palco.id)
  })

  it('lets a second project share the same Library buffer', async () => {
    const palcoId = await importLibraryAsset(plyFile())
    const first = await createProjectFromAsset(palcoId!)
    projects.set(first!, {
      id: first!,
      scenes: [{ environmentId: palcoId }],
    })
    const second = await createProjectFromAsset(palcoId!)
    expect(first).not.toBe(second)
    expect(useEnvironmentStore.getState().environmentId).toBe(palcoId)
    expect(await listLibraryAssets()).toHaveLength(1)
    expect(libraryBufferKeys().size).toBe(1)
  })
})

describe('insertLibraryAssetIntoScene', () => {
  function glbFile(name = 'Chair.glb') {
    return new File([new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0])], name, {
      type: 'model/gltf-binary',
    })
  }

  it('inserts a Model into the open scene and lands in Build', async () => {
    useProjectStore.setState({
      projectId: 'proj-open',
      activeSceneId: 'scene-1',
      scenes: [{ id: 'scene-1', name: 'Scene 1' }],
    })
    const id = await importLibraryAsset(glbFile())
    importModelFileMock.mockClear()
    const result = await insertLibraryAssetIntoScene(id!)
    expect(result).toBeTruthy()
    expect(importModelFileMock).toHaveBeenCalledTimes(1)
    expect(importModelFileMock.mock.calls[0]?.[0].name).toBe('Chair.glb')
    expect(useEditorStore.getState().appView).toBe('editor')
    expect(useEditorStore.getState().workspaceMode).toBe('build')
  })

  it('creates a new project when inserting with none open', async () => {
    expect(useProjectStore.getState().projectId).toBe('')
    const id = await importLibraryAsset(glbFile())
    const result = await insertLibraryAssetIntoScene(id!)
    expect(result).toBeTruthy()
    expect(useProjectStore.getState().projectId).not.toBe('')
    expect(importModelFileMock).toHaveBeenCalled()
  })

  it('refuses to insert a Location', async () => {
    const id = await importLibraryAsset(plyFile())
    const result = await insertLibraryAssetIntoScene(id!)
    expect(result).toBeNull()
    expect(useSceneStore.getState().notice).toMatch(/Model/i)
    expect(importModelFileMock).not.toHaveBeenCalled()
  })

  it('refuses Create project on a Model', async () => {
    const id = await importLibraryAsset(glbFile())
    const result = await createProjectFromAsset(id!)
    expect(result).toBeNull()
    expect(useSceneStore.getState().notice).toMatch(/Only a Location/i)
  })
})

describe('collections', () => {
  it('creates and lists a collection owned by the current account', async () => {
    const id = await createLibraryCollection('Living room')
    expect(id).toBeTruthy()
    const listed = await listLibraryCollections()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ name: 'Living room', ownerId: LOCAL_LIBRARY_OWNER })
  })

  it('refuses an empty collection name', async () => {
    const id = await createLibraryCollection('   ')
    expect(id).toBeNull()
    expect(useSceneStore.getState().notice).toMatch(/name/i)
    expect(await listLibraryCollections()).toEqual([])
  })

  it('renames a collection', async () => {
    const id = await createLibraryCollection('Before')
    await renameLibraryCollection(id!, 'After')
    const listed = await listLibraryCollections()
    expect(listed[0]?.name).toBe('After')
  })

  it('files an asset into a collection and moves it back to Unfiled', async () => {
    const collectionId = await createLibraryCollection('Props')
    const assetId = await importLibraryAsset(plyFile())
    await assignAssetToCollection(assetId!, collectionId)
    let listed = await listLibraryAssets()
    expect(listed[0]?.collectionId).toBe(collectionId)
    await assignAssetToCollection(assetId!, null)
    listed = await listLibraryAssets()
    expect(listed[0]?.collectionId).toBeNull()
  })

  it('returns assets to Unfiled when their collection is deleted', async () => {
    const collectionId = await createLibraryCollection('Doomed')
    const assetId = await importLibraryAsset(plyFile())
    await assignAssetToCollection(assetId!, collectionId)
    await deleteLibraryCollection(collectionId!)
    expect(await listLibraryCollections()).toEqual([])
    const listed = await listLibraryAssets()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.collectionId).toBeNull()
  })

  it('imports into the collection being viewed', async () => {
    const collectionId = await createLibraryCollection('Stage sets')
    const assetId = await importLibraryAsset(plyFile(), collectionId)
    const listed = await listLibraryAssets()
    expect(listed[0]?.id).toBe(assetId)
    expect(listed[0]?.collectionId).toBe(collectionId)
  })
})

describe('tags', () => {
  it('adds a tag normalized to lowercase and trimmed', async () => {
    const assetId = await importLibraryAsset(plyFile())
    await addAssetTag(assetId!, '  Hero Prop  ')
    const listed = await listLibraryAssets()
    expect(listed[0]?.tags).toEqual(['hero prop'])
  })

  it('ignores duplicate and empty tags', async () => {
    const assetId = await importLibraryAsset(plyFile())
    await addAssetTag(assetId!, 'furniture')
    await addAssetTag(assetId!, 'Furniture')
    await addAssetTag(assetId!, '   ')
    const listed = await listLibraryAssets()
    expect(listed[0]?.tags).toEqual(['furniture'])
  })

  it('removes a tag', async () => {
    const assetId = await importLibraryAsset(plyFile())
    await addAssetTag(assetId!, 'hero')
    await addAssetTag(assetId!, 'furniture')
    await removeAssetTag(assetId!, 'hero')
    const listed = await listLibraryAssets()
    expect(listed[0]?.tags).toEqual(['furniture'])
  })
})

describe('deleteLibraryAsset', () => {
  it('refuses while any project still links the palco', async () => {
    const palcoId = await importLibraryAsset(plyFile())
    projects.set('proj-linked', { id: 'proj-linked', scenes: [{ environmentId: palcoId }] })
    const message = await deleteLibraryAsset(palcoId!)
    expect(message).toBe('Used in 1 project')
    expect(await listLibraryAssets()).toHaveLength(1)
  })

  it('deletes when no project points at it', async () => {
    const palcoId = await importLibraryAsset(plyFile())
    expect(await deleteLibraryAsset(palcoId!)).toBeNull()
    expect(await listLibraryAssets()).toEqual([])
  })
})

describe('plan kind (FR-001 to FR-005)', () => {
  it('preserves a plan record on read instead of coercing it to location', async () => {
    palcos.set('plan-1', {
      id: 'plan-1',
      name: 'Untitled plan',
      kind: 'plan',
      bufferKey: null,
      source: 'import',
      format: 'plan',
      createdAt: 1,
      ownerId: LOCAL_LIBRARY_OWNER,
      collectionId: null,
      tags: [],
    })
    const listed = await listLibraryAssets()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.kind).toBe('plan')
    expect(listed[0]?.format).toBe('plan')
    expect(listed[0]?.bufferKey).toBeNull()
  })

  it('excludes a plan from the live buffer keys, so the orphan sweep never chases a null', async () => {
    palcos.set('plan-1', {
      id: 'plan-1',
      name: 'Untitled plan',
      kind: 'plan',
      bufferKey: null,
      source: 'import',
      format: 'plan',
      createdAt: 1,
      ownerId: LOCAL_LIBRARY_OWNER,
      collectionId: null,
      tags: [],
    })
    await importLibraryAsset(plyFile())
    await listLibraryAssets()
    const keys = libraryBufferKeys()
    expect(keys.size).toBe(1)
    for (const key of keys) expect(typeof key).toBe('string')
    expect([...keys]).not.toContain(null)
  })

  it('deletes a plan without reaching for a buffer that was never written', async () => {
    palcos.set('plan-1', {
      id: 'plan-1',
      name: 'Untitled plan',
      kind: 'plan',
      bufferKey: null,
      source: 'import',
      format: 'plan',
      createdAt: 1,
      ownerId: LOCAL_LIBRARY_OWNER,
      collectionId: null,
      tags: [],
    })
    const { idbDelete } = await import('./idb')
    const spy = vi.mocked(idbDelete)
    spy.mockClear()
    expect(await deleteLibraryAsset('plan-1')).toBeNull()
    expect(await listLibraryAssets()).toEqual([])
    const bufferDeletes = spy.mock.calls.filter(([store]) => store === 'model-buffers')
    expect(bufferDeletes).toEqual([])
  })

  it('still defaults an unrecognised kind to location so older records load', async () => {
    palcos.set('env-odd', {
      id: 'env-odd',
      name: 'Mystery',
      kind: 'environment',
      bufferKey: 'env-odd',
      source: 'import',
      format: 'ply',
      createdAt: 1,
      ownerId: LOCAL_LIBRARY_OWNER,
    })
    const listed = await listLibraryAssets()
    expect(listed[0]?.kind).toBe('location')
  })
})

describe('plan assets (FR-006, FR-007)', () => {
  it('creates an untitled plan that owns no buffer and lands untagged', async () => {
    const id = await createPlanAsset()
    expect(id).toBeTruthy()
    const listed = await listLibraryAssets()
    expect(listed).toHaveLength(1)
    const plan = listed[0]!
    expect(plan.kind).toBe('plan')
    expect(plan.format).toBe('plan')
    expect(plan.name).toBe('Untitled plan')
    expect(plan.bufferKey).toBeNull()
    expect(plan.tags).toEqual([])
    expect(plan.plan?.walls).toHaveLength(4)
    const { planFromJSON, planArea } = await import('./floorPlanModel')
    expect(planArea(planFromJSON(plan.plan!).walls)).toBe(16)
    expect(plan.plan?.openings).toEqual([])
    // The decisive assertion: no bytes were written anywhere.
    expect(buffers.size).toBe(0)
  })

  it('files a new plan into the collection being viewed', async () => {
    const collectionId = await createLibraryCollection('Sets')
    const id = await createPlanAsset(collectionId)
    const listed = await listLibraryAssets()
    expect(listed[0]?.id).toBe(id)
    expect(listed[0]?.collectionId).toBe(collectionId)
  })

  it('saves a wall graph onto the record and reads it back intact', async () => {
    const id = await createPlanAsset()
    const graph = {
      walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.1, height: 2.4 }],
      openings: [],
    }
    await savePlanAsset(id, graph)
    const listed = await listLibraryAssets()
    expect(listed[0]?.plan).toEqual(graph)
  })

  it('renames a plan from the title chip', async () => {
    const id = await createPlanAsset()
    await renamePlanAsset(id, 'Living room')
    const listed = await listLibraryAssets()
    expect(listed[0]?.name).toBe('Living room')
  })

  it('keeps a concurrent rename and graph save without overwriting either', async () => {
    const id = await createPlanAsset()
    await Promise.all([
      savePlanAsset(id, { walls: [], openings: [] }),
      renamePlanAsset(id, 'Studio'),
    ])
    const asset = (await listLibraryAssets()).find((a) => a.id === id)!
    expect(asset.name).toBe('Studio')
    expect(asset.plan).toEqual({ walls: [], openings: [] })
  })

  it('refuses to save a graph onto a non-plan asset', async () => {
    const id = await importLibraryAsset(plyFile())
    await savePlanAsset(id!, { walls: [{ id: 'w1' }], openings: [] })
    const listed = await listLibraryAssets()
    expect(listed[0]?.plan).toBeUndefined()
  })

  it('refreshes the plan thumbnail on save so the card reflects the edit (FR-007)', async () => {
    const id = await createPlanAsset()
    const before = (await listLibraryAssets())[0]!.thumbnail
    await savePlanAsset(id, wallGraphForThumb)
    const after = (await listLibraryAssets())[0]!.thumbnail
    // a thumbnail is always written: the clay render where WebGL exists, the
    // letter still where it does not (jsdom has no canvas 2D, so it falls back)
    expect(after).toBeInstanceOf(Blob)
    expect(after).not.toBe(before)
  })
})

const wallGraphForThumb = {
  walls: [
    { id: 'w1', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.1, height: 2.4 },
    { id: 'w2', a: { x: 4, y: 0 }, b: { x: 4, y: 3 }, thickness: 0.1, height: 2.4 },
    { id: 'w3', a: { x: 4, y: 3 }, b: { x: 0, y: 3 }, thickness: 0.1, height: 2.4 },
    { id: 'w4', a: { x: 0, y: 3 }, b: { x: 0, y: 0 }, thickness: 0.1, height: 2.4 },
  ],
  openings: [],
}

describe('insertPlanIntoScene (FR-034 to FR-038)', () => {
  const wallGraph = {
    walls: [
      { id: 'w1', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.1, height: 2.4 },
      { id: 'w2', a: { x: 4, y: 0 }, b: { x: 4, y: 3 }, thickness: 0.1, height: 2.4 },
      { id: 'w3', a: { x: 4, y: 3 }, b: { x: 0, y: 3 }, thickness: 0.1, height: 2.4 },
      { id: 'w4', a: { x: 0, y: 3 }, b: { x: 0, y: 0 }, thickness: 0.1, height: 2.4 },
    ],
    openings: [],
  }

  async function makePlan(withWalls = true) {
    const id = await createPlanAsset()
    await savePlanAsset(id, withWalls ? wallGraph : { walls: [], openings: [] })
    return id
  }

  it('inserts a plan as one clay object carrying a copy of the graph', async () => {
    useProjectStore.setState({ projectId: 'proj-open', activeSceneId: 'scene-1', scenes: [{ id: 'scene-1', name: 'Scene 1' }] })
    const id = await makePlan()
    const objectId = await insertLibraryAssetIntoScene(id)
    expect(objectId).toBeTruthy()
    const objects = useSceneStore.getState().objects
    expect(objects).toHaveLength(1)
    const obj = objects[0]!
    expect(obj.bufferKey).toBeNull()
    expect(obj.plan).toEqual(wallGraph)
    expect(obj.root.children.length).toBeGreaterThan(0)
    expect(importModelFileMock).not.toHaveBeenCalled()
    expect(useEditorStore.getState().appView).toBe('editor')
  })

  it('creates a project named after the plan when none is open', async () => {
    expect(useProjectStore.getState().projectId).toBe('')
    const id = await makePlan()
    await renamePlanAsset(id, 'Living room')
    const objectId = await insertLibraryAssetIntoScene(id)
    expect(objectId).toBeTruthy()
    expect(useProjectStore.getState().projectId).not.toBe('')
  })

  it('refuses to insert an empty plan and says why', async () => {
    useProjectStore.setState({ projectId: 'proj-open', activeSceneId: 'scene-1', scenes: [{ id: 'scene-1', name: 'Scene 1' }] })
    const id = await makePlan(false)
    const objectId = await insertLibraryAssetIntoScene(id)
    expect(objectId).toBeNull()
    expect(useSceneStore.getState().notice).toMatch(/no walls/i)
    expect(useSceneStore.getState().objects).toHaveLength(0)
  })

  it('the inserted object keeps its own copy when the Library plan is later edited', async () => {
    useProjectStore.setState({ projectId: 'proj-open', activeSceneId: 'scene-1', scenes: [{ id: 'scene-1', name: 'Scene 1' }] })
    const id = await makePlan()
    const objectId = await insertLibraryAssetIntoScene(id)
    const inserted = useSceneStore.getState().objects[0]!
    const insertedGraph = JSON.stringify(inserted.plan)
    // edit the Library plan after insertion
    await savePlanAsset(id, { walls: [...wallGraph.walls, { id: 'w5', a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, thickness: 0.1, height: 2.4 }], openings: [] })
    // the inserted object's graph is unchanged
    expect(JSON.stringify(useSceneStore.getState().objects[0]!.plan)).toBe(insertedGraph)
    expect(objectId).toBeTruthy()
  })

  it('the inserted object survives edits made through the editor’s own mutation path (SC-007)', async () => {
    useProjectStore.setState({ projectId: 'proj-open', activeSceneId: 'scene-1', scenes: [{ id: 'scene-1', name: 'Scene 1' }] })
    const withDoor = {
      walls: wallGraph.walls,
      openings: [{ id: 'o1', wallId: 'w3', kind: 'door' as const, along: 2, width: 0.9, height: 2.1, sill: 0, side: 1 as const }],
    }
    const id = await createPlanAsset()
    await savePlanAsset(id, withDoor)
    await insertLibraryAssetIntoScene(id)
    const inserted = useSceneStore.getState().objects[0]!
    const before = JSON.stringify(inserted.plan)
    // the editor's real path: rehydrate the record, mutate in place, save
    const { planFromJSON, planActions } = await import('./floorPlanModel')
    const asset = await resolveLibraryAsset(id)
    const livePlan = planFromJSON(asset!.plan!)
    planActions.moveOpening(livePlan, 'o1', 3.0)
    await savePlanAsset(id, { walls: livePlan.walls, openings: livePlan.openings })
    const after = JSON.stringify(useSceneStore.getState().objects[0]!.plan)
    expect(after).toBe(before)
    // and the Library record did move — the edit landed where it belonged
    const saved = await resolveLibraryAsset(id)
    expect(JSON.stringify(saved!.plan)).not.toBe(before)
  })

  it('the inserted object includes a floor slab per derived room (FR-032)', async () => {
    useProjectStore.setState({ projectId: 'proj-open', activeSceneId: 'scene-1', scenes: [{ id: 'scene-1', name: 'Scene 1' }] })
    const id = await makePlan()
    await insertLibraryAssetIntoScene(id)
    const obj = useSceneStore.getState().objects[0]!
    // 4 wall pieces (no openings) + 1 floor slab for the single enclosed room
    expect(obj.root.children.length).toBe(5)
    // the slab is the one whose geometry is a flat shape, not a box
    const slabs = obj.root.children.filter((c) => (c as THREE.Mesh).geometry?.type === 'ShapeGeometry')
    expect(slabs).toHaveLength(1)
  })

  it('the inserted object obeys the grayscale Shade rule via the standard display resources', async () => {
    useProjectStore.setState({ projectId: 'proj-open', activeSceneId: 'scene-1', scenes: [{ id: 'scene-1', name: 'Scene 1' }] })
    const id = await makePlan()
    await insertLibraryAssetIntoScene(id)
    const obj = useSceneStore.getState().objects[0]!
    // makeObject derives the display material from shade, whatever the geometry builder used
    expect(obj.shade).toBeGreaterThanOrEqual(0)
    expect(obj.shade).toBeLessThanOrEqual(1)
    expect(obj.material).toBeDefined()
  })

  it('refuses Create project on a Plan, which is never an environment', async () => {
    const id = await makePlan()
    const result = await createProjectFromAsset(id)
    expect(result).toBeNull()
    expect(useSceneStore.getState().notice).toMatch(/Only a Location/i)
  })
})
