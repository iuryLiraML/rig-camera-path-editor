import * as THREE from 'three'
import type { RigKind } from './environment'
import { parseGlbScene } from './gltfParse'
import { idbGet, idbPut, STORES } from './idb'

export type AssetThumbKind = 'person' | 'points' | 'mesh'

export function assetThumbKind(asset: {
  rigKind?: RigKind
  keepPoints?: boolean
}): AssetThumbKind {
  if (asset.rigKind === 'dummy' || asset.rigKind === 'sam-person') return 'person'
  if (asset.keepPoints) return 'points'
  return 'mesh'
}

export async function readCachedAssetThumb(bufferKey: string): Promise<string | undefined> {
  return idbGet<string>(STORES.assetThumbs, bufferKey)
}

export async function writeCachedAssetThumb(bufferKey: string, dataUrl: string) {
  await idbPut(STORES.assetThumbs, dataUrl, bufferKey)
}

function clayRenderer(): THREE.WebGLRenderer | null {
  if (typeof document === 'undefined' || import.meta.env.MODE === 'test') return null
  try {
    const gl = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    })
    gl.setPixelRatio(2)
    gl.outputColorSpace = THREE.SRGBColorSpace
    return gl
  } catch {
    return null
  }
}

function renderClay(gl: THREE.WebGLRenderer, root: THREE.Object3D, size: number): string {
  gl.setSize(size, size, false)
  gl.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const cloned = root.clone(true)
  cloned.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setScalar(0.82),
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
    })
  })
  scene.add(cloned)
  const box = new THREE.Box3().setFromObject(cloned)
  const center = box.getCenter(new THREE.Vector3())
  const dim = box.getSize(new THREE.Vector3())
  cloned.position.sub(center)
  scene.add(new THREE.AmbientLight(0xffffff, 0.48))
  const key = new THREE.DirectionalLight(0xffffff, 1.15)
  key.position.set(2.4, 4.2, 2)
  scene.add(key)
  const max = Math.max(dim.x, dim.y, dim.z, 0.01)
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 40)
  camera.position.set(0.95, 0.62, 1.05).normalize().multiplyScalar(max * 2.65)
  camera.lookAt(0, 0, 0)
  gl.render(scene, camera)
  return gl.domElement.toDataURL('image/png')
}

/** Clay preview of a stored mesh, cached in IndexedDB by buffer key. */
export async function clayThumbForBuffer(bufferKey: string, size = 256): Promise<string | null> {
  const cached = await readCachedAssetThumb(bufferKey)
  if (cached) return cached
  const gl = clayRenderer()
  if (!gl) return null
  const buffer = await idbGet<ArrayBuffer>(STORES.buffers, bufferKey)
  if (!buffer) return null
  try {
    const { scene } = await parseGlbScene(buffer)
    const url = renderClay(gl, scene, size)
    gl.dispose()
    await writeCachedAssetThumb(bufferKey, url)
    return url
  } catch {
    gl.dispose()
    return null
  }
}
