import * as THREE from 'three'
import {
  PRIMITIVE_KINDS,
  buildPrimitiveGeometry,
  defaultParams,
  type PrimitiveKind,
  type PrimitiveSpec,
  primitiveSpecKey,
} from './primitiveGeometry'
import { ensureDummyTemplate, type FigureSex } from './dummyCharacter'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'

const cache = new Map<string, string>()
const figures = new Map<FigureSex, Promise<string | null>>()
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

function renderOne(gl: THREE.WebGLRenderer, root: THREE.Object3D, kind: string, size: number): string {
  gl.setSize(size, size, false)
  gl.setClearColor(0x000000, 0)
  gl.shadowMap.enabled = true
  gl.shadowMap.type = THREE.PCFSoftShadowMap
  const scene = new THREE.Scene()
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(root, true)
  const center = bounds.getCenter(new THREE.Vector3())
  const dim = bounds.getSize(new THREE.Vector3())
  root.position.sub(center)
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setScalar(0.82), roughness: 0.88, metalness: 0,
    side: THREE.DoubleSide,
  })
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) { node.material = material; node.castShadow = true }
  })
  scene.add(root)

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
  material.dispose()
  ground.geometry.dispose()
  ;(ground.material as THREE.Material).dispose()
  key.shadow.map?.dispose()
  return url
}

/** Clay thumbnail keyed by the complete spec and output size. */
export function primitiveThumbUrl(input: PrimitiveKind | PrimitiveSpec, size = 256): string | null {
  const spec = typeof input === 'string' ? { kind: input, params: defaultParams(input) } : input
  const key = `${size}:${primitiveSpecKey(spec)}`
  const cached = cache.get(key)
  if (cached) return cached
  const gl = getRenderer()
  if (!gl) return null
  let geometry: THREE.BufferGeometry | undefined
  try {
    geometry = buildPrimitiveGeometry(spec)
    const url = renderOne(gl, new THREE.Mesh(geometry), spec.kind, size)
    cache.set(key, url)
    if (cache.size > 48) cache.delete(cache.keys().next().value!)
    return url
  } catch { return null } finally { geometry?.dispose() }
}

/** Clone the bundled skinned GLB; never mutate the scene's rig or source materials. */
export function figureThumbUrl(sex: FigureSex): Promise<string | null> {
  const cached = figures.get(sex)
  if (cached) return cached
  const pending = (async () => {
    const gl = getRenderer()
    if (!gl) return null
    const template = await ensureDummyTemplate(sex)
    if (!template) return null
    const root = clone(template.scene)
    root.traverse((node) => { if (node instanceof THREE.SkinnedMesh) node.skeleton.update() })
    try { return renderOne(gl, root, sex, 256) } finally {
      const skeletons = new Set<THREE.Skeleton>()
      root.traverse((node) => { if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton) })
      skeletons.forEach((skeleton) => skeleton.dispose())
    }
  })().catch(() => null).then((url) => { if (!url) figures.delete(sex); return url })
  figures.set(sex, pending)
  return pending
}

export function warmPrimitiveThumbs() {
  for (const kind of PRIMITIVE_KINDS) primitiveThumbUrl(kind)
}
