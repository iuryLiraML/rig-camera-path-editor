import * as THREE from 'three'
import { isOrbitLocked } from '../lib/orbitLock'
import type { PaneView } from '../state/useLayoutStore'
import { sceneBounds } from './SceneObjects'

export type SpatialView = 'front' | 'top' | 'right'

const VIEW_DIRS: Record<SpatialView, [number, number, number]> = {
  front: [0, 0.12, 1],
  top: [0.001, 1, 0.001],
  right: [1, 0.12, 0],
}

const _center = new THREE.Vector3()
const _size = new THREE.Vector3()
const _dir = new THREE.Vector3()

function makeCamera() {
  return new THREE.PerspectiveCamera(40, 1, 0.05, 200)
}

export const spatialCameras: Record<SpatialView, THREE.PerspectiveCamera> = {
  front: makeCamera(),
  top: makeCamera(),
  right: makeCamera(),
}

export const spatialTargets: Record<SpatialView, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0.8, 0),
  top: new THREE.Vector3(0, 0.8, 0),
  right: new THREE.Vector3(0, 0.8, 0),
}

const framed: Record<SpatialView, boolean> = { front: false, top: false, right: false }
const editorTarget = new THREE.Vector3(0, 0.8, 0)
let boundView: PaneView | null = null

export function isSpatialView(view: PaneView): view is SpatialView {
  return view === 'front' || view === 'top' || view === 'right'
}

export type OrbitLike = {
  object: THREE.Object3D
  target: THREE.Vector3
  enabled: boolean
  minPolarAngle: number
  maxPolarAngle: number
  update: () => void
}

/** Place a spatial camera on the scene, overwriting any user orbit. */
export function frameSpatialCamera(view: SpatialView, aspect: number) {
  const cam = spatialCameras[view]
  const box = sceneBounds()
  if (box) {
    box.getCenter(_center)
    box.getSize(_size)
  } else {
    _center.set(0, 0.8, 0)
    _size.set(2, 2, 2)
  }
  const radius = _size.length() / 2 || 1
  const dist = radius * 2.6 + 1
  _dir.set(...VIEW_DIRS[view]).normalize()
  cam.position.copy(_center).addScaledVector(_dir, dist)
  cam.up.set(0, 1, 0)
  cam.lookAt(_center)
  cam.near = 0.05
  cam.far = 200
  cam.fov = 40
  cam.aspect = aspect
  cam.updateProjectionMatrix()
  spatialTargets[view].copy(_center)
  framed[view] = true
}

/** Frame once, then keep the pose so orbit/pan/zoom stick. */
export function ensureSpatialCamera(view: SpatialView, aspect: number) {
  if (!framed[view]) {
    frameSpatialCamera(view, aspect)
    return
  }
  const cam = spatialCameras[view]
  if (Math.abs(cam.aspect - aspect) > 1e-4) {
    cam.aspect = aspect
    cam.updateProjectionMatrix()
  }
}

export function resetSpatialViews() {
  framed.front = false
  framed.top = false
  framed.right = false
  boundView = null
  editorTarget.set(0, 0.8, 0)
  spatialTargets.front.set(0, 0.8, 0)
  spatialTargets.top.set(0, 0.8, 0)
  spatialTargets.right.set(0, 0.8, 0)
}

function applyPolar(controls: OrbitLike, view: PaneView) {
  if (view === 'editor') {
    controls.minPolarAngle = 0.02
    controls.maxPolarAngle = Math.PI - 0.02
    return
  }
  controls.minPolarAngle = 0
  controls.maxPolarAngle = Math.PI
}

function saveBoundTarget(controls: OrbitLike) {
  if (boundView && isSpatialView(boundView)) {
    spatialTargets[boundView].copy(controls.target)
    return
  }
  if (boundView === 'editor' || boundView === null) {
    editorTarget.copy(controls.target)
  }
}

/**
 * Point the shared OrbitControls at the pane under the cursor. The cinema
 * pane stays look-only so orbiting it cannot rewrite the shot camera.
 */
export function bindOrbitToPane(
  controls: OrbitLike,
  view: PaneView | null,
  editorCam: THREE.Camera,
  allowNavigate: boolean,
) {
  const next: PaneView = view ?? 'editor'
  if (!allowNavigate) {
    controls.enabled = false
    return
  }
  if (next === 'camera') {
    if (boundView !== 'camera') saveBoundTarget(controls)
    boundView = 'camera'
    controls.enabled = false
    return
  }
  const canOrbit = !isOrbitLocked()
  if (boundView === next) {
    controls.enabled = canOrbit
    applyPolar(controls, next)
    return
  }
  saveBoundTarget(controls)
  boundView = next
  if (isSpatialView(next)) {
    ensureSpatialCamera(next, spatialCameras[next].aspect || 1)
    controls.object = spatialCameras[next]
    controls.target.copy(spatialTargets[next])
  } else {
    controls.object = editorCam
    controls.target.copy(editorTarget)
  }
  applyPolar(controls, next)
  controls.enabled = canOrbit
  controls.update()
}
