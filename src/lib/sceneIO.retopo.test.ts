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
  installHighMeshBuffer,
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

function embeddedGltf(
  nodes: Array<{ mesh: number }>,
  meshes: Array<{ primitives: Array<{ attributes: { POSITION: number } }> }>,
): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const data = Buffer.from(positions.buffer).toString('base64')
  return new TextEncoder().encode(JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes,
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: 'VEC3',
      max: [1, 1, 0],
      min: [0, 0, 0],
    }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
    buffers: [{ uri: `data:application/octet-stream;base64,${data}`, byteLength: positions.byteLength }],
  })).buffer
}

async function withProgressEvent<T>(run: () => Promise<T>): Promise<T> {
  const previous = globalThis.ProgressEvent
  globalThis.ProgressEvent = class extends Event {
    lengthComputable = false
    loaded = 0
    total = 0
  } as typeof ProgressEvent
  try {
    return await run()
  } finally {
    globalThis.ProgressEvent = previous
  }
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
      '"Car" is dense (estimated source: 240k triangles). Remeshing with Tripo…',
    )
  })

  it('skips the viewport when there is no Fal key', () => {
    expect(denseImportDecision('Car', 240_000, 12_000, false)).toEqual({
      action: 'skip',
      notice: denseRemeshNeedsKeyCopy('Car', 240_000),
    })
    expect(denseRemeshNeedsKeyCopy('Car', 240_000)).toBe(
      '"Car" is dense (estimated source: 240k triangles). Add a Fal key in Settings to remesh.',
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
  it('imports embedded glTF with an accurate cached triangle count', async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const data = Buffer.from(positions.buffer).toString('base64')
    const buffer = new TextEncoder().encode(JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        max: [1, 1, 0],
        min: [0, 0, 0],
      }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
      buffers: [{ uri: `data:application/octet-stream;base64,${data}`, byteLength: positions.byteLength }],
    })).buffer
    const previousProgressEvent = globalThis.ProgressEvent
    globalThis.ProgressEvent = class extends Event {
      lengthComputable = false
      loaded = 0
      total = 0
    } as typeof ProgressEvent
    try {
      const imported = await importModelFile(
        new File([buffer], 'Triangle.gltf', { type: 'model/gltf+json' }),
        { autoRemesh: false },
      )
      expect(imported?.triangles).toBe(1)
      expect(useSceneStore.getState().objects[0]?.modelFormat).toBe('gltf')
    } finally {
      globalThis.ProgressEvent = previousProgressEvent
    }
  })

  it('imports geometry-only OBJ with an accurate cached triangle count', async () => {
    const obj = new TextEncoder().encode([
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'v 0 1 0',
      'f 1 2 3 4',
    ].join('\n')).buffer
    const imported = await importModelFile(new File([obj], 'Panel.obj', { type: 'text/plain' }), {
      autoRemesh: false,
    })
    expect(imported?.triangles).toBe(2)
    const object = useSceneStore.getState().objects[0]
    expect(object?.sourceFormat).toBe('obj')
    expect(object?.modelFormat).toBe('obj')
    expect(object?.triangleCount).toBe(2)
    expect(object?.bufferKey).toBe(object?.id)
    expect(countTriangles(object.root)).toBe(2)
    expect(isRemeshPlaceholder(object.root)).toBe(false)
  })

  it('keeps a dense placeholder when Fal is unavailable so high mesh remains an option', async () => {
    const enqueued: string[] = []
    setDenseRemeshEnqueue((id) => {
      enqueued.push(id)
    })
    const buffer = encodeGlb({
      asset: { version: '2.0' },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [{ count: 4 }, { count: 240_003 }],
    })

    const imported = await importModelBuffer(buffer, 'Boat', { autoRemesh: true })

    expect(imported?.triangles).toBe(80_001)
    expect(enqueued).toEqual([])
    expect(useSceneStore.getState().objects).toHaveLength(1)
    expect(isRemeshPlaceholder(useSceneStore.getState().objects[0].root)).toBe(true)
    expect(useSceneStore.getState().notice).toBe(
      '"Boat" is dense (estimated source: 80k triangles). Add a Fal key in Settings to remesh.',
    )
  })

  it('counts only glTF meshes instantiated by the loaded scene', async () => {
    const buffer = embeddedGltf(
      [{ mesh: 0 }],
      [
        { primitives: [{ attributes: { POSITION: 0 } }] },
        { primitives: [{ attributes: { POSITION: 0 } }] },
      ],
    )
    const imported = await withProgressEvent(
      () => importModelBuffer(buffer, 'Unused mesh', { autoRemesh: false }),
    )

    expect(imported?.triangles).toBe(1)
    expect(useSceneStore.getState().objects[0]?.triangleCount).toBe(1)
  })

  it('counts every rendered instance of a shared glTF mesh', async () => {
    const buffer = embeddedGltf(
      [{ mesh: 0 }, { mesh: 0 }],
      [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    )
    const imported = await withProgressEvent(
      () => importModelBuffer(buffer, 'Instanced mesh', { autoRemesh: false }),
    )

    expect(imported?.triangles).toBe(2)
    expect(useSceneStore.getState().objects[0]?.triangleCount).toBe(2)
  })

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

  it('remeshes from memory when persisting the dense source fails', async () => {
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
    expect(enqueued).toEqual([useSceneStore.getState().objects[0].id])
    expect(useSceneStore.getState().notice).toBe(
      '"Car" storage is unavailable. Remeshing from the in-memory source…',
    )
    const object = useSceneStore.getState().objects[0]
    expect(object?.name).toBe('Car')
    expect(isRemeshPlaceholder(object.root)).toBe(true)
  })
})

describe('dense project restore without a viewport parse', () => {
  it('reloads persisted OBJ metadata and source geometry', async () => {
    const buffer = new TextEncoder().encode([
      'v 0 0 0',
      'v 1 0 0',
      'v 0 1 0',
      'f 1 2 3',
    ].join('\n')).buffer
    const object = await objectFromStoredBuffer(
      {
        id: 'panel',
        name: 'Panel',
        shade: 0.7,
        bufferKey: 'panel',
        modelFormat: 'obj',
        displayMode: 'wireframe',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        keys: [],
        playClips: true,
        triangleCount: 1,
      },
      buffer,
    )
    expect(object.modelFormat).toBe('obj')
    expect(object.displayMode).toBe('wireframe')
    expect(object.triangleCount).toBe(1)
    expect(isRemeshPlaceholder(object.root)).toBe(false)
  })

  it('keeps the placeholder cube solid until Keep high mesh installs the source topology', async () => {
    const buffer = new TextEncoder().encode([
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'v 0 1 0',
      'f 1 2 3 4',
    ].join('\n')).buffer
    const parked = objectFromDenseMeta({
      id: 'panel',
      name: 'Panel',
      shade: 0.7,
      bufferKey: 'panel',
      modelFormat: 'obj',
      displayMode: 'wireframe',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      keys: [],
      playClips: true,
      triangleCount: RETOPO_TRIANGLES + 1,
    })
    useSceneStore.setState({ objects: [parked] })
    let placeholderMaterial: THREE.Material | undefined
    parked.root.traverse((child) => {
      if (child instanceof THREE.Mesh) placeholderMaterial = child.material as THREE.Material
    })
    expect(placeholderMaterial).toBe(parked.material)

    await installHighMeshBuffer('panel', buffer)
    const live = useSceneStore.getState().objects[0]
    expect(isRemeshPlaceholder(live.root)).toBe(false)
    expect(live.displayMode).toBe('wireframe')
    expect(live.triangleCount).toBe(2)
    let sourceMaterial: THREE.Material & { wireframe?: boolean } | undefined
    live.root.traverse((child) => {
      if (child instanceof THREE.Mesh) sourceMaterial = child.material as THREE.Material
    })
    expect(sourceMaterial?.wireframe).toBe(true)
  })

  it('explains why a saved dense mesh comes back as a cube', () => {
    expect(denseLoadParkCopy('Car', 240_000)).toBe(
      '"Car" is dense (estimated source: 240k triangles). Remesh from the object bar.',
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
    expect(denseLoadCanSkipBuffer({ ...meta, remeshed: true })).toBe(false)
    expect(denseLoadCanSkipBuffer({ ...meta, triangleCount: RETOPO_TRIANGLES })).toBe(false)
    expect(denseLoadCanSkipBuffer({ ...meta, triangleCount: undefined })).toBe(false)
    expect(denseLoadCanSkipBuffer({ ...meta, keepDenseMesh: true })).toBe(false)
    expect(denseLoadCanSkipBuffer({ ...meta, rigKind: 'sam-person' })).toBe(false)
    const object = objectFromDenseMeta(meta)
    expect(isRemeshPlaceholder(object.root)).toBe(true)
    expect(object.triangleCount).toBe(RETOPO_TRIANGLES + 1)
    expect(object.bufferKey).toBe('car')
  })
})
