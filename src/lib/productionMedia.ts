import { idbGet, idbPut, STORES } from './idb'
import { assertGlbMesh } from './assetSniff'
import { persistModelBuffer } from './readModelFile'
import { clayThumbForBuffer } from './assetThumb'
import { listLibraryAssets, type LibraryAsset } from './library'
import { parseGlbScene } from './gltfParse'
import type { Mesh } from 'three'

const PREFIX = 'production-media:'

export async function storeProductionImage(blob: Blob, id: string = crypto.randomUUID()): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) {
    throw new Error('Use a PNG, JPEG or WebP reference image.')
  }
  if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error('Reference images must be between 1 byte and 20 MB.')
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  if (!(blob.type === 'image/png' && png || blob.type === 'image/jpeg' && jpeg || blob.type === 'image/webp' && webp)) {
    throw new Error('That file is not a readable PNG, JPEG or WebP image.')
  }
  await idbPut(STORES.productionMedia, blob, id)
  return `${PREFIX}${id}`
}

export async function loadProductionImage(uri: string): Promise<Blob> {
  if (uri.startsWith(PREFIX)) {
    const blob = await idbGet<Blob>(STORES.productionMedia, uri.slice(PREFIX.length))
    if (!blob) throw new Error('This reference image is not available on this device. Upload it again.')
    return blob
  }
  const url = new URL(uri)
  if (url.protocol !== 'https:' && !/^data:image\/(png|jpeg|webp);base64,/.test(uri)) {
    throw new Error('Use an uploaded image or an HTTPS image URL.')
  }
  const response = await fetch(uri)
  if (!response.ok) throw new Error(`Reference download failed (${response.status}).`)
  return response.blob()
}

/** Stable result ID makes ingestion retryable without creating duplicate Library assets. */
export async function ingestProductionModel(input: { id: string; name: string; ownerId: string; url: string }): Promise<string> {
  const existing = await idbGet<LibraryAsset>(STORES.library, input.id)
  if (existing) return existing.id
  if (new URL(input.url).protocol !== 'https:') throw new Error('The provider returned an invalid model URL.')
  const response = await fetch(input.url)
  if (!response.ok) throw new Error(`3D download failed (${response.status}). Resume to retry the download.`)
  const bytes = await response.arrayBuffer()
  assertGlbMesh(bytes)
  const parsed = await parseGlbScene(bytes)
  let triangles = 0
  parsed.scene.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh) return
    triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position?.count ?? 0) / 3
    mesh.geometry.dispose()
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose()
  })
  if (!triangles) throw new Error('The returned model has no renderable geometry.')
  await persistModelBuffer(input.id, bytes)
  let thumbnail: Blob | undefined
  const thumb = await clayThumbForBuffer(input.id).catch(() => null)
  if (thumb) thumbnail = await (await fetch(thumb)).blob()
  const asset: LibraryAsset = {
    id: input.id, name: input.name, ownerId: input.ownerId, kind: 'model', format: 'glb',
    bufferKey: input.id, source: 'import', createdAt: Date.now(), collectionId: null,
    tags: ['production'], thumbnail,
  }
  await idbPut(STORES.library, asset)
  await listLibraryAssets()
  return input.id
}
