/**
 * Triangle counts from glTF JSON only — no GLTFLoader, no BufferGeometry.
 * Import uses this to decide remesh without building a dense scene on the
 * main thread (that parse is what froze the editor).
 */

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const MODE_TRIANGLES = 4
const MODE_TRIANGLE_STRIP = 5
const MODE_TRIANGLE_FAN = 6

type GltfDoc = {
  accessors?: Array<{ count?: number }>
  meshes?: Array<{
    primitives?: Array<{
      mode?: number
      indices?: number
      attributes?: { POSITION?: number }
    }>
  }>
}

function trianglesInPrimitive(
  primitive: NonNullable<NonNullable<GltfDoc['meshes']>[number]['primitives']>[number],
  accessors: NonNullable<GltfDoc['accessors']>,
): number {
  const mode = primitive.mode ?? MODE_TRIANGLES
  const position = primitive.attributes?.POSITION
  if (typeof position !== 'number') return 0
  const index = typeof primitive.indices === 'number' ? accessors[primitive.indices] : undefined
  const pos = accessors[position]
  const count = index?.count ?? pos?.count ?? 0
  if (!Number.isFinite(count) || count <= 0) return 0
  if (mode === MODE_TRIANGLES) return Math.floor(count / 3)
  if (mode === MODE_TRIANGLE_STRIP || mode === MODE_TRIANGLE_FAN) return Math.max(0, count - 2)
  return 0
}

export function countTrianglesInGltfDoc(doc: GltfDoc): number {
  const accessors = doc.accessors ?? []
  let total = 0
  for (const mesh of doc.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      total += trianglesInPrimitive(primitive, accessors)
    }
  }
  return total
}

function parseGlbJson(buffer: ArrayBuffer): GltfDoc | null {
  if (buffer.byteLength < 20) return null
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== GLB_MAGIC) return null
  const jsonLength = view.getUint32(12, true)
  const jsonType = view.getUint32(16, true)
  if (jsonType !== JSON_CHUNK) return null
  if (20 + jsonLength > buffer.byteLength) return null
  const bytes = new Uint8Array(buffer, 20, jsonLength)
  let end = bytes.length - 1
  while (end >= 0 && (bytes[end] === 0x20 || bytes[end] === 0)) end -= 1
  const text = new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end + 1))
  try {
    return JSON.parse(text) as GltfDoc
  } catch {
    return null
  }
}

function parseGltfJson(buffer: ArrayBuffer): GltfDoc | null {
  try {
    const text = new TextDecoder().decode(buffer).trim()
    if (!text.startsWith('{')) return null
    return JSON.parse(text) as GltfDoc
  } catch {
    return null
  }
}

/** Null when the buffer is not readable glTF — caller may fall back to a full parse. */
export function countGltfTriangles(buffer: ArrayBuffer): number | null {
  const doc = parseGlbJson(buffer) ?? parseGltfJson(buffer)
  if (!doc) return null
  return countTrianglesInGltfDoc(doc)
}
