import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeObject, useSceneStore } from '../state/useSceneStore'
import { configureFal, resetFalForTests } from './fal/client'
import { syncFalSettings } from './fal/settings'
import { persistModelBuffer } from './readModelFile'

vi.mock('./readModelFile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./readModelFile')>()
  return {
    ...actual,
    persistModelBuffer: vi.fn(async (_key: string, buffer: ArrayBuffer) => buffer),
  }
})
import {
  countTriangles,
  objectNeedsRetopo,
  RETOPO_TRIANGLES,
  FAL_REMESH_MAX_BYTES,
  undoLastMeshRevision,
  clearMeshRevisionsForTests,
  pushMeshRevisionForTests,
  denseImportDecision,
  denseRemeshStartCopy,
  denseRemeshNeedsKeyCopy,
  remeshTooLargeCopy,
  formatTriangleCount,
  importModelBuffer,
  importModelFile,
  isRemeshPlaceholder,
  makeRemeshPlaceholderRoot,
  setDenseRemeshEnqueue,
  clearParkedMeshesForTests,
  objectFromStoredBuffer,
  objectFromDenseMeta,
  denseLoadCanSkipBuffer,
  denseLoadParkCopy,
  denseLoadParkManyCopy,
} from './sceneIO'
import { setHistoryClockForTests } from './history'

function meshWithTriangles(count: number) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(count * 3), 1))
  const root = new THREE.Group()
  root.add(new THREE.Mesh(geometry))
  return root
}

function encodeGlb(doc: object): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(doc))
  const pad = (4 - (json.length % 4)) % 4
  const chunk = json.length + pad
  const bytes = new Uint8Array(12 + 8 + chunk)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.byteLength, true)
  view.setUint32(12, chunk, true)
  view.setUint32(16, 0x4e4f534a, true)
  bytes.set(json, 20)
  return bytes.buffer
}

afterEach(() => {
  useSceneStore.setState({ objects: [], pendingLifts: [], notice: null })
  clearMeshRevisionsForTests()
  clearParkedMeshesForTests()
  setHistoryClockForTests(0)
  setDenseRemeshEnqueue(null)
  resetFalForTests()
  syncFalSettings('', '3.1')
  vi.mocked(persistModelBuffer).mockReset()
  vi.mocked(persistModelBuffer).mockImplementation(async (_key, buffer) => buffer)
})

describe('retopo thresholds', () => {
  it('counts indexed triangles', () => {
    expect(countTriangles(meshWithTriangles(12))).toBe(12)
  })

  it('flags imported meshes above 80k', () => {
    const light = makeObject('Light', meshWithTriangles(100), { id: 'light', bufferKey: 'light' })
    const heavy = makeObject('Heavy', meshWithTriangles(RETOPO_TRIANGLES + 1), {
      id: 'heavy',
      bufferKey: 'heavy',
    })
    const primitive = makeObject('Box', meshWithTriangles(RETOPO_TRIANGLES + 1), {
      id: 'prim',
      bufferKey: null,
    })
    useSceneStore.setState({ objects: [light, heavy, primitive] })
    expect(objectNeedsRetopo('light')).toBe(false)
    expect(objectNeedsRetopo('heavy')).toBe(true)
    expect(objectNeedsRetopo('prim')).toBe(false)
  })

  it('uses the cached triangle count on a remesh placeholder, not the cube', () => {
    const parked = makeObject('Car', makeRemeshPlaceholderRoot(), {
      id: 'car',
      bufferKey: 'car',
      triangleCount: RETOPO_TRIANGLES + 1,
    })
    useSceneStore.setState({ objects: [parked] })
    expect(countTriangles(parked.root)).toBe(12)
    expect(objectNeedsRetopo('car')).toBe(true)
  })

  it('does not steal Ctrl+Z when the remeshed object is gone, unselected, or history is newer', () => {
    pushMeshRevisionForTests('missing', new ArrayBuffer(8))
    expect(undoLastMeshRevision(null)).toBe(false)
    expect(undoLastMeshRevision('missing')).toBe(false)
    pushMeshRevisionForTests('car', new ArrayBuffer(8), 0)
    setHistoryClockForTests(2)
    expect(undoLastMeshRevision('car')).toBe(false)
  })
})

describe('auto-remesh import decision', () => {
  it('formats triangle counts the way the notices do', () => {
    expect(formatTriangleCount(240_000)).toBe('240k triangles')
    expect(formatTriangleCount(90_000)).toBe('90k triangles')
    expect(formatTriangleCount(2_000_000)).toBe('2.0M triangles')
  })

  it('auto-sends dense meshes when Fal is ready', () => {
    expect(denseImportDecision('Car', 240_000, 12_000, true)).toEqual({
      action: 'remesh',
      notice: denseRemeshStartCopy('Car', 240_000),
    })
    expect(denseRemeshStartCopy('Car', 240_000)).toBe(
      '"Car" is dense (240k triangles). Remeshing with Tripo…',
    )
  })

  it('skips the viewport when there is no Fal key', () => {
    expect(denseImportDecision('Car', 240_000, 12_000, false)).toEqual({
      action: 'skip',
      notice: denseRemeshNeedsKeyCopy('Car', 240_000),
    })
    expect(denseRemeshNeedsKeyCopy('Car', 240_000)).toBe(
      '"Car" is dense (240k triangles). Add a Fal key in Settings to remesh.',
    )
  })

  it('refuses files over the Fal 150 MB cap', () => {
    expect(denseImportDecision('Car', 240_000, FAL_REMESH_MAX_BYTES + 1, true)).toEqual({
      action: 'skip',
      notice: remeshTooLargeCopy('Car'),
    })
    expect(remeshTooLargeCopy('Car')).toBe('"Car" is too large to remesh (max 150 MB).')
  })

  it('imports clay-friendly meshes without remesh', () => {
    expect(denseImportDecision('Car', RETOPO_TRIANGLES, FAL_REMESH_MAX_BYTES + 1, false)).toEqual({
      action: 'import',
    })
  })
})

describe('dense import without a viewport parse', () => {
  it('parks a placeholder and never builds the dense GLB scene', async () => {
    configureFal('key-test')
    syncFalSettings('key-test', '3.1')
    const enqueued: string[] = []
    setDenseRemeshEnqueue((id) => {
      enqueued.push(id)
    })
    const buffer = encodeGlb({
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [{ count: 4 }, { count: 240_003 }],
    })
    const imported = await importModelBuffer(buffer, 'Car', { autoRemesh: true })
    expect(imported?.triangles).toBe(80_001)
    const object = useSceneStore.getState().objects[0]
    expect(object?.name).toBe('Car')
    expect(isRemeshPlaceholder(object.root)).toBe(true)
    expect(countTriangles(object.root)).toBe(12)
    expect(object.triangleCount).toBe(80_001)
    expect(enqueued).toEqual([object.id])
  })

  it('reads a dense File off the import path and still parks a placeholder', async () => {
    configureFal('key-test')
    syncFalSettings('key-test', '3.1')
    const enqueued: string[] = []
    setDenseRemeshEnqueue((id) => {
      enqueued.push(id)
    })
    const buffer = encodeGlb({
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [{ count: 4 }, { count: 240_003 }],
    })
    const imported = await importModelFile(new File([buffer], 'Car.glb', { type: 'model/gltf-binary' }))
    expect(imported?.triangles).toBe(80_001)
    const object = useSceneStore.getState().objects[0]
    expect(isRemeshPlaceholder(object.root)).toBe(true)
    expect(enqueued).toEqual([object.id])
  })

  it('does not enqueue remesh when persist throws', async () => {
    configureFal('key-test')
    syncFalSettings('key-test', '3.1')
    const enqueued: string[] = []
    setDenseRemeshEnqueue((id) => {
      enqueued.push(id)
    })
    vi.mocked(persistModelBuffer).mockRejectedValueOnce(new Error('idb put failed'))
    const buffer = encodeGlb({
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [{ count: 4 }, { count: 240_003 }],
    })
    const imported = await importModelBuffer(buffer, 'Car', { autoRemesh: true })
    expect(imported?.triangles).toBe(80_001)
    expect(enqueued).toEqual([])
    expect(useSceneStore.getState().notice).toBe('"Car" imported, but remesh needs a re-import')
    const object = useSceneStore.getState().objects[0]
    expect(object?.name).toBe('Car')
    expect(isRemeshPlaceholder(object.root)).toBe(true)
  })
})

describe('dense project restore without a viewport parse', () => {
  it('explains why a saved dense mesh comes back as a cube', () => {
    expect(denseLoadParkCopy('Car', 240_000)).toBe(
      '"Car" is dense (240k triangles). Remesh from the object bar.',
    )
    expect(denseLoadParkManyCopy(3)).toBe('3 dense models loaded as placeholders. Remesh from the object bar.')
  })

  it('rebuilds a saved dense GLB as a placeholder from the JSON count', async () => {
    const buffer = encodeGlb({
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [{ count: 4 }, { count: 240_003 }],
    })
    const object = await objectFromStoredBuffer(
      {
        id: 'car',
        name: 'Car',
        shade: 0.7,
        bufferKey: 'car',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        keys: [],
        playClips: true,
      },
      buffer,
    )
    expect(isRemeshPlaceholder(object.root)).toBe(true)
    expect(countTriangles(object.root)).toBe(12)
    expect(object.triangleCount).toBe(80_001)
    expect(object.bufferKey).toBe('car')
    expect(objectNeedsRetopo('car')).toBe(false)
    useSceneStore.setState({ objects: [object] })
    expect(objectNeedsRetopo('car')).toBe(true)
  })

  it('skips the IndexedDB clone when the saved meta already knows the mesh is dense', () => {
    const meta = {
      id: 'car',
      name: 'Car',
      shade: 0.7,
      bufferKey: 'car',
      transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
      keys: [],
      playClips: true,
      triangleCount: RETOPO_TRIANGLES + 1,
    }
    expect(denseLoadCanSkipBuffer(meta)).toBe(true)
    expect(denseLoadCanSkipBuffer({ ...meta, triangleCount: RETOPO_TRIANGLES })).toBe(false)
    expect(denseLoadCanSkipBuffer({ ...meta, triangleCount: undefined })).toBe(false)
    const object = objectFromDenseMeta(meta)
    expect(isRemeshPlaceholder(object.root)).toBe(true)
    expect(object.triangleCount).toBe(RETOPO_TRIANGLES + 1)
    expect(object.bufferKey).toBe('car')
  })
})
