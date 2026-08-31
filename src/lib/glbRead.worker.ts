/// <reference lib="webworker" />

import { countGltfTriangles } from './glbTriangleCount'
import { idbGet, idbPut, STORES } from './idb'
import { countObjTriangles } from './objTriangleCount'
import type { ModelSourceFormat } from './readModelFile'

type Request =
  | { op?: 'read'; id: number; file?: Blob; format?: ModelSourceFormat }
  | { op: 'wrap'; id: number; buffer: ArrayBuffer; name: string; type: string }
  | { op: 'put'; id: number; key: string; buffer: ArrayBuffer }
  | { op: 'getWrap'; id: number; key: string; name: string; type: string }
type Response =
  | { id: number; buffer: ArrayBuffer; triangles?: number | null }
  | { id: number; file: File }
  | { id: number; error: string }

self.onmessage = async (event: MessageEvent<Request>) => {
  const data = event.data
  try {
    if (data.op === 'wrap') {
      const file = new File([data.buffer], data.name, { type: data.type })
      self.postMessage({ id: data.id, file } satisfies Response)
      return
    }
    if (data.op === 'put') {
      await idbPut(STORES.buffers, data.buffer, data.key)
      self.postMessage({ id: data.id, buffer: data.buffer } satisfies Response, [data.buffer])
      return
    }
    if (data.op === 'getWrap') {
      const buffer = await idbGet<ArrayBuffer>(STORES.buffers, data.key)
      if (!buffer) throw new Error('The original file is missing')
      const file = new File([buffer], data.name, { type: data.type })
      self.postMessage({ id: data.id, file } satisfies Response)
      return
    }
    if (!data.file) throw new Error('No file')
    const buffer = await data.file.arrayBuffer()
    const triangles =
      data.format === 'obj' ? countObjTriangles(buffer) : countGltfTriangles(buffer)
    self.postMessage({ id: data.id, buffer, triangles } satisfies Response, [buffer])
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies Response)
  }
}

export {}
