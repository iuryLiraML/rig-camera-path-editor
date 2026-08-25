import { describe, expect, it } from 'vitest'
import { countGltfTriangles, countTrianglesInGltfDoc } from './glbTriangleCount'

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
  accessors: [{ count: 4 }, { count: 240_000 }],
}

describe('countGltfTriangles', () => {
  it('reads indexed TRIANGLES from a GLB JSON chunk without a BIN', () => {
    expect(countGltfTriangles(encodeGlb(denseDoc))).toBe(80_000)
  })

  it('reads a .gltf JSON buffer the same way', () => {
    const text = new TextEncoder().encode(JSON.stringify(denseDoc))
    expect(countGltfTriangles(text.buffer.slice(text.byteOffset, text.byteOffset + text.byteLength))).toBe(
      80_000,
    )
  })

  it('returns null for garbage so import can fall back to a full parse', () => {
    expect(countGltfTriangles(new ArrayBuffer(8))).toBeNull()
  })

  it('counts triangle strips from the accessor length', () => {
    expect(
      countTrianglesInGltfDoc({
        accessors: [{ count: 12 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 5 }] }],
      }),
    ).toBe(10)
  })
})
