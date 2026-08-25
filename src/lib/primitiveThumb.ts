import * as THREE from 'three'
import {
  PRIMITIVE_KINDS,
  buildPrimitiveGeometry,
  defaultParams,
  type PrimitiveKind,
} from './primitiveGeometry'

const cache: Partial<Record<PrimitiveKind, string | null>> = {}
let renderer: THREE.WebGLRenderer | null | undefined

function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer !== undefined) return renderer
  if (typeof document === 'undefined' || import.meta.env.MODE === 'test') {
    renderer = null
    return null
  }
  try {
    const gl = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    })
    gl.setPixelRatio(2)
    gl.outputColorSpace = THREE.SRGBColorSpace
    renderer = gl
    return gl
  } catch {
    renderer = null
    return null
  }
}

function renderOne(gl: THREE.WebGLRenderer, kind: PrimitiveKind, size: number): string {
  gl.setSize(size, size, false)
  gl.setClearColor(0x000000, 0)
  gl.shadowMap.enabled = true
  gl.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const geo = buildPrimitiveGeometry({ kind, params: defaultParams(kind) })
  geo.computeBoundingBox()
  const bounds = geo.boundingBox!
  const center = bounds.getCenter(new THREE.Vector3())
  const dim = bounds.getSize(new THREE.Vector3())
  geo.translate(-center.x, -center.y, -center.z)

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setScalar(0.82),
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = true
  scene.add(mesh)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.ShadowMaterial({ opacity: 0.32 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -dim.y / 2 - 0.01
  ground.receiveShadow = true
  scene.add(ground)

  scene.add(new THREE.AmbientLight(0xffffff, 0.48))
  const key = new THREE.DirectionalLight(0xffffff, 1.15)
  key.position.set(2.4, 4.2, 2)
  key.castShadow = true
  key.shadow.mapSize.set(512, 512)
  key.shadow.camera.near = 0.2
  key.shadow.camera.far = 16
  const extent = Math.max(dim.x, dim.y, dim.z, 1) * 1.4
  key.shadow.camera.left = -extent
  key.shadow.camera.right = extent
  key.shadow.camera.top = extent
  key.shadow.camera.bottom = -extent
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, 0.28)
  fill.position.set(-2.8, 1.2, -1.4)
  scene.add(fill)

  const max = Math.max(dim.x, dim.y, dim.z, 0.01)
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 40)
  const fromAbove = kind === 'plane' ? 1.05 : 0.62
  const dist = kind === 'plane' ? 3.2 : kind === 'torus' ? 2.7 : 2.65
  camera.position.set(0.95, fromAbove, 1.05).normalize().multiplyScalar(max * dist)
  camera.lookAt(0, 0, 0)

  gl.render(scene, camera)
  const url = gl.domElement.toDataURL('image/png')
  geo.dispose()
  material.dispose()
  ground.geometry.dispose()
  ;(ground.material as THREE.Material).dispose()
  return url
}

/** Clay thumbnail of the default primitive — same geometry the scene will spawn. */
export function primitiveThumbUrl(kind: PrimitiveKind, size = 256): string | null {
  if (kind in cache) return cache[kind] ?? null
  const gl = getRenderer()
  if (!gl) {
    cache[kind] = null
    return null
  }
  try {
    cache[kind] = renderOne(gl, kind, size)
  } catch {
    cache[kind] = null
  }
  return cache[kind] ?? null
}

export function warmPrimitiveThumbs() {
  for (const kind of PRIMITIVE_KINDS) primitiveThumbUrl(kind)
}
