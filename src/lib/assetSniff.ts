/** Fal File.content_type is a docs placeholder (often image/png). Sniff bytes. */

export type SniffedAsset =
  | 'glb'
  | 'gltf-json'
  | 'ply-binary'
  | 'ply-ascii'
  | 'png'
  | 'html'
  | 'unknown'

const GLB_MAGIC = 0x46546c67

function headerText(buffer: ArrayBuffer, max = 256): string {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, max))
  return new TextDecoder().decode(bytes)
}

export function sniffAsset(buffer: ArrayBuffer): SniffedAsset {
  if (buffer.byteLength < 4) return 'unknown'
  const view = new DataView(buffer)
  if (view.getUint32(0, true) === GLB_MAGIC) return 'glb'
  const png =
    view.getUint8(0) === 0x89 &&
    view.getUint8(1) === 0x50 &&
    view.getUint8(2) === 0x4e &&
    view.getUint8(3) === 0x47
  if (png) return 'png'
  const text = headerText(buffer)
  const trimmed = text.trimStart()
  if (trimmed.startsWith('<')) return 'html'
  if (trimmed.startsWith('{')) return 'gltf-json'
  if (/^ply\b/i.test(trimmed)) {
    if (/format\s+ascii\b/i.test(trimmed)) return 'ply-ascii'
    if (/format\s+binary_(?:little|big)_endian\b/i.test(trimmed)) return 'ply-binary'
    return 'ply-ascii'
  }
  return 'unknown'
}

export function isGltfMeshBuffer(buffer: ArrayBuffer): boolean {
  const kind = sniffAsset(buffer)
  if (kind === 'glb') return true
  if (kind !== 'gltf-json') return false
  const text = headerText(buffer, 128)
  return /"asset"\s*:/.test(text)
}

export function assertGlbMesh(buffer: ArrayBuffer): void {
  if (isGltfMeshBuffer(buffer)) return
  const kind = sniffAsset(buffer)
  if (kind === 'ply-ascii' || kind === 'ply-binary') {
    throw new Error('That file is a Gaussian splat or PLY mesh, not a GLB. Use Environment import for palco files.')
  }
  throw new Error('That download is not a GLB mesh.')
}

export function assertGaussianSplat(buffer: ArrayBuffer, fileName?: string): 'ply' | 'splat' {
  const kind = sniffAsset(buffer)
  if (kind === 'ply-ascii') {
    throw new Error(
      'This splat is ASCII PLY. The viewport loader needs binary little-endian PLY (or .splat).',
    )
  }
  if (kind === 'ply-binary') return 'ply'
  if (kind === 'glb' || kind === 'gltf-json') {
    throw new Error('That file is a GLB mesh, not a Gaussian splat. Import it as an object instead.')
  }
  if (kind === 'png' || kind === 'html') {
    throw new Error('Fal returned an image or error page instead of a splat file.')
  }
  if (fileName && /\.splat$/i.test(fileName) && buffer.byteLength >= 32) return 'splat'
  if (fileName && /\.ply$/i.test(fileName)) {
    throw new Error('This PLY is not a binary Gaussian splat the viewport can load.')
  }
  throw new Error('Environment import accepts binary .ply or .splat only.')
}
