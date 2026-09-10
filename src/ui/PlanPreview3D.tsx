/**
 * The floor-plan editor's live 3D preview: the plan's extrusion in clay,
 * beside the 2D canvas. Walls rise as you draw them; each derived room gets a
 * floor slab; no room gets a ceiling, because a walkable interior with a lid
 * cannot be filmed from above — the dollhouse read is the point.
 *
 * This is a private preview scene, not the user's scene: it carries its own
 * hemisphere/key light and grid so the clay reads, and none of that touches
 * the project's lighting. Geometry comes from the shared buildPlanGroup.
 */
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { PlanState } from '../lib/floorPlanModel'
import { buildPlanGroup } from '../lib/planGeometry'
import { clayFloorMaterial, clayMaterial } from '../lib/clayMaterial'

// Persistent across rebuilds — allocating a material per edit would leak GPU.
const CLAY = clayMaterial()
const FLOOR = clayFloorMaterial()

export function PlanPreview3D({ plan, fitNonce }: { plan: PlanState; fitNonce: number }) {
  const [unavailable, setUnavailable] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    group: THREE.Group
  } | null>(null)
  const framedKey = useRef('')

  /** Fit the plan's bounding sphere on the smaller FOV, keeping the orbit direction. */
  function frame(t: NonNullable<typeof threeRef.current>) {
    const sphere = new THREE.Box3().setFromObject(t.group).getBoundingSphere(new THREE.Sphere())
    if (!sphere.radius) return
    const { width, height } = t.renderer.domElement.getBoundingClientRect()
    if (width && height) { t.camera.aspect = width / height; t.camera.updateProjectionMatrix() }
    const vFov = (t.camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (t.camera.aspect || 1))
    const dist = (sphere.radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.08
    const dir = t.camera.position.clone().sub(t.controls.target).normalize()
    if (!dir.lengthSq()) dir.set(1, 0.9, 1).normalize()
    t.controls.target.copy(sphere.center)
    t.camera.position.copy(sphere.center).add(dir.multiplyScalar(dist))
    t.controls.update()
  }

  // one-time setup
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    } catch {
      setUnavailable(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0f0f11)
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400)
    camera.position.set(9, 8, 9)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.target.set(3, 0.6, 3)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x35353c, 0.85))
    const key = new THREE.DirectionalLight(0xffffff, 1.25)
    key.position.set(6, 11, 4)
    scene.add(key)
    const grid = new THREE.GridHelper(80, 320, 0x24242b, 0x1a1a20)
    scene.add(grid)
    const group = new THREE.Group()
    scene.add(group)
    threeRef.current = { renderer, scene, camera, controls, group }

    let raf = 0
    const tick = () => {
      const r = canvas.getBoundingClientRect()
      if (r.width && (canvas.width !== Math.floor(r.width * renderer.getPixelRatio()) || canvas.height !== Math.floor(r.height * renderer.getPixelRatio()))) {
        renderer.setSize(r.width, r.height, false)
        camera.aspect = r.width / r.height
        camera.updateProjectionMatrix()
      }
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(raf)
      controls.dispose()
      group.traverse((node) => { if (node instanceof THREE.Mesh) node.geometry.dispose() })
      grid.geometry.dispose()
      const materials = Array.isArray(grid.material) ? grid.material : [grid.material]
      materials.forEach((material) => material.dispose())
      renderer.dispose()
      threeRef.current = null
    }
  }, [])

  // rebuild on every mutation — version bumps even though the plan reference
  // is stable, because actions mutate in place
  useEffect(() => {
    const t = threeRef.current
    if (!t) return
    // dispose the previous geometry before dropping it, or every keystroke leaks GPU
    t.group.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry.dispose()
    })
    t.group.clear()
    t.group.add(buildPlanGroup(plan, { wall: CLAY, floor: FLOOR }))
    // frame the plan when its wall count changes, never mid-orbit
    const key = `${plan.walls.length}`
    if (plan.walls.length && key !== framedKey.current) {
      framedKey.current = key
      frame(t)
    }
  }, [plan, plan.version])

  // the Fit action reframes the preview too, on demand (FR-025)
  useEffect(() => {
    const t = threeRef.current
    if (!t || !fitNonce || !plan.walls.length) return
    frame(t)
  }, [fitNonce])

  if (unavailable) return <p role="status" className="p-6 text-sm text-ink-dim">3D preview is unavailable. Enable WebGL or reopen this page. You can still edit and save the 2D plan.</p>

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full"
      aria-label="3D preview of the floor plan extrusion"
    />
  )
}
