import { describe, expect, it } from 'vitest'
import {
  FILE_WRAP_OFFTHREAD_BYTES,
  fileFromBuffer,
  inspectModelBuffer,
  modelIoOffthreadAvailable,
  persistModelBuffer,
  readModelBytes,
  shouldPersistOffthread,
} from './readModelFile'

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

const denseDoc = {
  asset: { version: '2.0' },
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  accessors: [{ count: 4 }, { count: 240_003 }],
}

describe('readModelBytes', () => {
  it('counts triangulated faces from an OBJ source', async () => {
    const buffer = new TextEncoder().encode(
      ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'f 1 2 3 4'].join('\n'),
    ).buffer
    expect(inspectModelBuffer(buffer, 'obj').triangles).toBe(2)
    const read = await readModelBytes(buffer, 'obj')
    expect(read.triangles).toBe(2)
  })

  it('counts triangles from a GLB buffer without building a scene', async () => {
    const buffer = encodeGlb(denseDoc)
    expect(inspectModelBuffer(buffer).triangles).toBe(80_001)
    const read = await readModelBytes(buffer)
    expect(read.triangles).toBe(80_001)
    expect(read.buffer.byteLength).toBe(buffer.byteLength)
  })

  it('reads a File the same way', async () => {
    const buffer = encodeGlb(denseDoc)
    const file = new File([buffer], 'Car.glb', { type: 'model/gltf-binary' })
    const read = await readModelBytes(file)
    expect(read.triangles).toBe(80_001)
    expect(read.buffer.byteLength).toBe(buffer.byteLength)
  })

  it('wraps a buffer as a named GLB File without changing the byte length', async () => {
    const buffer = encodeGlb(denseDoc)
    const file = await fileFromBuffer(buffer, 'Car.glb', 'model/gltf-binary')
    expect(file.name).toBe('Car.glb')
    expect(file.type).toBe('model/gltf-binary')
    expect(file.size).toBe(buffer.byteLength)
  })

  it('keeps small IndexedDB writes on the main thread when the worker cannot open IDB', () => {
    expect(shouldPersistOffthread(12)).toBe(false)
    expect(shouldPersistOffthread(FILE_WRAP_OFFTHREAD_BYTES)).toBe(modelIoOffthreadAvailable())
  })

  it('persist then remesh wrap of the same logical bytes keeps File size', async () => {
    const bytes = new Uint8Array(FILE_WRAP_OFFTHREAD_BYTES)
    bytes.fill(6)
    const buffer = bytes.buffer
    const originalLength = buffer.byteLength
    const previousWorker = globalThis.Worker
    const previousIdb = globalThis.indexedDB
    globalThis.indexedDB = previousIdb ?? ({} as IDBFactory)

    class TransferWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      postMessage(
        payload: { op?: string; id: number; buffer?: ArrayBuffer; name?: string; type?: string },
        transfer: Transferable[] = [],
      ) {
        let workerBuffer = payload.buffer
        if (workerBuffer && transfer.includes(workerBuffer)) {
          workerBuffer = structuredClone(workerBuffer, { transfer: [workerBuffer] })
        }
        queueMicrotask(() => {
          if (payload.op === 'put') {
            this.onmessage?.({ data: { id: payload.id, buffer: workerBuffer } } as MessageEvent)
            return
          }
          if (payload.op === 'wrap' && workerBuffer) {
            const file = new File([workerBuffer], payload.name ?? 'out.glb', {
              type: payload.type ?? '',
            })
            this.onmessage?.({ data: { id: payload.id, file } } as MessageEvent)
          }
        })
      }
      terminate() {}
    }
    globalThis.Worker = TransferWorker as unknown as typeof Worker

    try {
      const persisted = await persistModelBuffer('car', buffer)
      expect(persisted.byteLength).toBe(originalLength)
      const file = await fileFromBuffer(persisted, 'Car.glb', 'model/gltf-binary')
      expect(file.size).toBe(originalLength)
      expect(persisted.byteLength).toBe(originalLength)
    } finally {
      globalThis.Worker = previousWorker
      if (previousIdb === undefined) Reflect.deleteProperty(globalThis, 'indexedDB')
      else globalThis.indexedDB = previousIdb
    }
  })
})
