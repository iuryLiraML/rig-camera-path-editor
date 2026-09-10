/**
 * A clay thumbnail of a floor plan's extrusion, for the Library card. Renders
 * the model's pieces offscreen at a fixed size, the same way the primitive
 * thumbnail renderer does. Returns null where WebGL is unavailable so the
 * caller can fall back to the letter still.
 */
import * as THREE from 'three'
import { planFromJSON, type StoredPlan } from './floorPlanModel'
import { buildPlanGroup } from './planGeometry'

let shared: THREE.WebGLRenderer | null = null

function renderer(): THREE.WebGLRenderer | null {
  if (shared) return shared
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    shared = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
    return shared
  } catch {
    return null
  }
}

export async function renderPlanThumb(plan: StoredPlan, size = 360): Promise<string | null> {
  const gl = renderer()
  if (!gl) return null
  const state = planFromJSON(plan)
  if (!state.walls.length) return null

  const group = buildPlanGroup(state)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x16161a)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x35353c, 0.85))
  const key = new THREE.DirectionalLight(0xffffff, 1.25)
  key.position.set(6, 11, 4)
  scene.add(key)
  scene.add(group)

  const bounds = new THREE.Box3().setFromObject(group)
  const sphere = bounds.getBoundingSphere(new THREE.Sphere())
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400)
  const dist = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.1
  camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.9, 1).normalize().multiplyScalar(dist))
  camera.lookAt(sphere.center)

  gl.setSize(size, size, false)
  gl.render(scene, camera)
  const url = gl.domElement.toDataURL('image/png')
  // one-shot render: dispose everything we allocated
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose()
      ;(node.material as THREE.Material).dispose()
    }
  })
  return url
}
