import { countGltfTriangles } from './glbTriangleCount'
import { idbGet, idbPut, STORES } from './idb'
import { countObjTriangles } from './objTriangleCount'

export type ModelSourceFormat = 'glb' | 'gltf' | 'obj'

export type ModelBytes = {
  buffer: ArrayBuffer
  triangles: number | null
}

export function inspectModelBuffer(
  buffer: ArrayBuffer,
  format: ModelSourceFormat = 'glb',
): ModelBytes {
  return {
    buffer,
    triangles: format === 'obj' ? countObjTriangles(buffer) : countGltfTriangles(buffer),
  }
}

type WorkerReadOk = { id: number; buffer: ArrayBuffer; triangles?: number | null }
type WorkerWrapOk = { id: number; file: File }
type WorkerErr = { id: number; error: string }
type WorkerMsg = WorkerReadOk | WorkerWrapOk | WorkerErr

/** Below this, File wrap is cheap enough to stay on the main thread. */
export const FILE_WRAP_OFFTHREAD_BYTES = 256 * 1024

function openModelWorker() {
  return new Worker(new URL('./glbRead.worker.ts', import.meta.url), { type: 'module' })
}

function workerCall<T>(
  payload: Record<string, unknown>,
  transfer: Transferable[],
  pick: (data: Exclude<WorkerMsg, WorkerErr>) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = openModelWorker()
    const finish = (fn: () => void) => {
      worker.terminate()
      fn()
    }
    worker.onmessage = (event: MessageEvent<WorkerMsg>) => {
      const data = event.data
      if ('error' in data) {
        finish(() => reject(new Error(data.error)))
        return
      }
      try {
        const value = pick(data)
        finish(() => resolve(value))
      } catch (error) {
        finish(() => reject(error))
      }
    }
    worker.onerror = (event) => {
      finish(() => reject(event.error ?? new Error(event.message || 'Model worker failed')))
    }
    worker.postMessage(payload, transfer)
  })
}

function readInWorker(file: Blob, format: ModelSourceFormat): Promise<ModelBytes> {
  return workerCall({ op: 'read', id: 1, file, format }, [], (data) => {
    if (!('buffer' in data)) throw new Error('Model worker did not return bytes')
    return { buffer: data.buffer, triangles: data.triangles ?? null }
  })
}

function wrapInWorker(buffer: ArrayBuffer, name: string, type: string): Promise<File> {
  return workerCall({ op: 'wrap', id: 1, buffer, name, type }, [buffer], (data) => {
    if (!('file' in data)) throw new Error('Model worker did not return a File')
    return data.file
  })
}

/** Clone so a worker transfer cannot detach the only copy the caller still holds. */
function cloneForWorkerTransfer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0)
}

/** Builds a File for Fal upload. Large buffers wrap off the main thread. */
export async function fileFromBuffer(buffer: ArrayBuffer, name: string, type: string): Promise<File> {
  if (typeof Worker === 'function' && buffer.byteLength >= FILE_WRAP_OFFTHREAD_BYTES) {
    try {
      return await wrapInWorker(cloneForWorkerTransfer(buffer), name, type)
    } catch (error) {
      if (buffer.byteLength === 0) throw error
    }
  }
  return new File([buffer], name, { type })
}

/** Reads GLB/GLTF bytes and counts triangles. Uses a worker when the browser has one. */
export async function readModelBytes(
  source: Blob | ArrayBuffer,
  format: ModelSourceFormat = 'glb',
): Promise<ModelBytes> {
  if (source instanceof ArrayBuffer) return inspectModelBuffer(source, format)
  if (typeof Worker === 'function') {
    try {
      return await readInWorker(source, format)
    } catch {
      // Node tests and browsers that reject module workers fall back here.
    }
  }
  return inspectModelBuffer(await source.arrayBuffer(), format)
}

export function modelIoOffthreadAvailable(): boolean {
  return typeof Worker === 'function' && typeof indexedDB !== 'undefined'
}

export function shouldPersistOffthread(byteLength: number): boolean {
  return byteLength >= FILE_WRAP_OFFTHREAD_BYTES && modelIoOffthreadAvailable()
}

function putInWorker(key: string, buffer: ArrayBuffer): Promise<ArrayBuffer> {
  return workerCall({ op: 'put', id: 1, key, buffer }, [buffer], (data) => {
    if (!('buffer' in data) || !data.buffer) throw new Error('Model worker did not return the buffer')
    return data.buffer
  })
}

function getWrapInWorker(key: string, name: string, type: string): Promise<File> {
  return workerCall({ op: 'getWrap', id: 1, key, name, type }, [], (data) => {
    if (!('file' in data)) throw new Error('Model worker did not return a File')
    return data.file
  })
}

/** Writes a model buffer to IndexedDB. Large writes clone off the main thread. */
export async function persistModelBuffer(key: string, buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (shouldPersistOffthread(buffer.byteLength)) {
    try {
      await putInWorker(key, cloneForWorkerTransfer(buffer))
      if (buffer.byteLength === 0) throw new Error('Model buffer was detached')
      return buffer
    } catch (error) {
      if (buffer.byteLength === 0) throw error
    }
  }
  await idbPut(STORES.buffers, buffer, key)
  return buffer
}

/** Loads a stored GLB as a File without materializing the bytes on the main thread. */
export async function fileFromStoredBuffer(
  key: string,
  name: string,
  type: string,
): Promise<File | undefined> {
  if (modelIoOffthreadAvailable()) {
    try {
      return await getWrapInWorker(key, name, type)
    } catch {
      // Fall back to a main-thread get when the worker cannot open IDB.
    }
  }
  const buffer = await idbGet<ArrayBuffer>(STORES.buffers, key)
  if (!buffer) return undefined
  return fileFromBuffer(buffer, name, type)
}
