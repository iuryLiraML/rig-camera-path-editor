import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { lockOrbit, restoreViewportNav, unlockOrbit } from '../lib/orbitLock'
import { useShiftHeld } from '../lib/useShiftHeld'
import { beginPickClick, hasInteractivePick } from '../lib/viewportPick'
import { aimOrbitAtWorldOrigin } from '../lib/orbitHome'
import { isCinemaViewport, isPathStrokeTool } from '../lib/workspaceChrome'
import { useEditorStore } from '../state/useEditorStore'
import { computeRects, paneAt, useLayoutStore } from '../state/useLayoutStore'
import { cinemaCameraRef } from './rig/CinemaCamera'
import { sceneBounds } from './SceneObjects'
import {
  bindOrbitToPane,
  frameSpatialCamera,
  homeSpatialCamera,
  isSpatialView,
  spatialCameras,
  spatialTargets,
} from './spatialViews'

/** distance of the initial framing — the zoom readout's 100% reference */
const DEFAULT_DIST = 7.9
const ORTHO_DEFAULT_ZOOM = 110

const VIEW_DIRS = {
  front: new THREE.Vector3(0, 0.12, 1),
  top: new THREE.Vector3(0.001, 1, 0.001),
  right: new THREE.Vector3(1, 0.12, 0),
}

/** Live handle to the editor viewport camera, so "pose from view" can read it. */
export const editorCameraRef: { current: THREE.Camera | null } = { current: null }

export function EditorCamera() {
  const projection = useEditorStore((s) => s.projection)
  const tool = useEditorStore((s) => s.tool)
  const playMode = useEditorStore((s) => s.playMode)
  const cameraView = useEditorStore((s) => s.cameraView)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const frameRequest = useEditorStore((s) => s.frameRequest)
  const homeRequest = useEditorStore((s) => s.homeRequest)
  const viewRequest = useEditorStore((s) => s.viewRequest)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const fallbackCam = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const editorCamActive = !isCinemaViewport(playMode, cameraView, workspaceMode)
  const lastZoom = useRef(100)
  const perspRef = useRef<THREE.PerspectiveCamera>(null)
  const orthoRef = useRef<THREE.OrthographicCamera>(null)
  const shiftHeld = useShiftHeld()
  const pointerView = useRef<'editor' | 'camera' | 'front' | 'top' | 'right'>('editor')

  const editorCam = (): THREE.Camera => {
    const owned = projection === 'perspective' ? perspRef.current : orthoRef.current
    return owned ?? fallbackCam
  }

  // F — frame the pane under the cursor (or the editor camera in single view)
  useEffect(() => {
    if (frameRequest === 0 || !controls) return
    const view = pointerView.current
    if (isSpatialView(view)) {
      frameSpatialCamera(view, spatialCameras[view].aspect || 1)
      controls.target.copy(spatialTargets[view])
      if (controls.object === spatialCameras[view]) controls.update()
      return
    }
    const camera = editorCam()
    const box = sceneBounds()
    if (!box) return
    const center = box.getCenter(new THREE.Vector3())
    const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1
    const direction = camera.position.clone().sub(controls.target).normalize()
    controls.target.copy(center)
    camera.position.copy(center.clone().add(direction.multiplyScalar(radius * 2.4)))
    controls.update()
  }, [frameRequest, controls, fallbackCam, projection])

  // H — look at the world origin at the default framing distance
  useEffect(() => {
    if (homeRequest === 0 || !controls) return
    const view = pointerView.current
    if (isSpatialView(view)) {
      homeSpatialCamera(view)
      controls.target.copy(spatialTargets[view])
      if (controls.object === spatialCameras[view]) controls.update()
      return
    }
    const camera = editorCam()
    aimOrbitAtWorldOrigin(camera.position, controls.target)
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const ortho = camera as THREE.OrthographicCamera
      ortho.zoom = ORTHO_DEFAULT_ZOOM
      ortho.updateProjectionMatrix()
    }
    controls.update()
  }, [homeRequest, controls, fallbackCam, projection])

  // quick views — snap the camera to an axis, keeping the current distance
  useEffect(() => {
    if (!viewRequest || !controls) return
    const camera = editorCam()
    const box = sceneBounds()
    const center = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0.8, 0)
    const dist = Math.max(2, camera.position.distanceTo(controls.target))
    const dir = VIEW_DIRS[viewRequest.view].clone().normalize()
    camera.position.copy(center.clone().add(dir.multiplyScalar(dist)))
    controls.target.copy(center)
    controls.update()
  }, [viewRequest, controls, fallbackCam, projection])

  const controlsRef = useRef(controls)
  controlsRef.current = controls
  const scene = useThree((s) => s.scene)

  // Draw / pick can leave OrbitControls bound to the cinema pane, or a lock
  // held after a missed pointerup. Esc and workspace used to ignore both, so
  // LMB orbit stayed dead. Reset onto the editor camera whenever nav should
  // work again.
  useEffect(() => {
    pointerView.current = 'editor'
    restoreViewportNav(controlsRef.current)
    const current = controlsRef.current
    if (current && editorCamActive && !isPathStrokeTool(tool)) {
      bindOrbitToPane(current, 'editor', editorCam(), true)
    }
  }, [tool, workspaceMode, playMode, cameraView, editorCamActive, projection])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      pointerView.current = 'editor'
      restoreViewportNav(controlsRef.current)
      const current = controlsRef.current
      if (current && editorCamActive) {
        bindOrbitToPane(current, 'editor', editorCam(), true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editorCamActive, projection])

  // Bind orbit to whichever pane the pointer is in, before OrbitControls sees
  // the event — otherwise a drag in Front would spin the Editor camera.
  // A hit on a mesh/gizmo/anchor locks orbit for the whole gesture so a
  // select click cannot start an orbit on the same down.
  useEffect(() => {
    const el = gl.domElement
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let held = false

    const sync = (e: PointerEvent | WheelEvent) => {
      const rect = el.getBoundingClientRect()
      const leaf = paneAt(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)
      const view = leaf?.view ?? 'editor'
      pointerView.current = view
      const current = controlsRef.current
      if (!current) return
      bindOrbitToPane(current, view, editorCam(), editorCamActive)
    }

    const release = () => {
      if (!held) return
      held = false
      unlockOrbit()
      const current = controlsRef.current
      if (current) bindOrbitToPane(current, pointerView.current, editorCam(), editorCamActive)
    }

    const onDown = (e: PointerEvent) => {
      sync(e)
      // Middle button is pan (same as RMB). Stop the browser autoscroll glyph.
      if (e.button === 1) e.preventDefault()
      if (e.button !== 0 || !editorCamActive) return
      const rect = el.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      const leaf = paneAt(e.clientX - rect.left, e.clientY - rect.top, w, h)
      const leaves = computeRects(useLayoutStore.getState().root, { x: 0, y: 0, w, h }).leaves
      const pane = (leaf && leaves.get(leaf.id)) ?? { x: 0, y: 0, w, h }
      ndc.set(
        ((e.clientX - rect.left - pane.x) / Math.max(1, pane.w)) * 2 - 1,
        -((e.clientY - rect.top - pane.y) / Math.max(1, pane.h)) * 2 + 1,
      )
      let cam = editorCam()
      if (leaf && isSpatialView(leaf.view)) cam = spatialCameras[leaf.view]
      else if (leaf?.view === 'camera' && cinemaCameraRef.current) cam = cinemaCameraRef.current
      raycaster.params.Line = { threshold: 0.03 }
      raycaster.setFromCamera(ndc, cam)
      const hits = raycaster.intersectObjects(scene.children, true)
      beginPickClick(e.clientX, e.clientY)
      // Pen / Draw own LMB — locking orbit here left the viewport stuck
      // if pointerup did not reach the release handler after a stroke.
      if (isPathStrokeTool(useEditorStore.getState().tool)) return
      if (!hasInteractivePick(hits)) return
      lockOrbit()
      held = true
      const current = controlsRef.current
      if (current) bindOrbitToPane(current, pointerView.current, editorCam(), editorCamActive)
    }

    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointermove', sync, true)
    el.addEventListener('wheel', sync, { capture: true, passive: true })
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointermove', sync, true)
      el.removeEventListener('wheel', sync, true)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      release()
    }
  }, [gl, editorCamActive, projection, playMode, cameraView, scene])

  useFrame(() => {
    const camera = editorCam()
    editorCameraRef.current = camera
    // In look-through, OrbitControls defaults to R3F's cinema camera — pin it
    // back. In quad view the pointer may be on Front/Top, so do not steal the
    // binding back to the editor camera every frame.
    if (cameraView && controls && controls.object !== camera) {
      controls.object = camera as THREE.PerspectiveCamera
    }
    if (controls && !cameraView) {
      bindOrbitToPane(controls, pointerView.current, camera, editorCamActive)
    }

    if (!editorCamActive) return
    if (pointerView.current !== 'editor') return
    let pct: number
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      pct = Math.round(((camera as THREE.OrthographicCamera).zoom / ORTHO_DEFAULT_ZOOM) * 100)
    } else {
      const target = controls ? controls.target : ZERO
      pct = Math.round((DEFAULT_DIST / Math.max(0.01, camera.position.distanceTo(target))) * 100)
    }
    if (Number.isFinite(pct) && pct !== lastZoom.current) {
      lastZoom.current = pct
      useEditorStore.getState().setZoomPct(pct)
    }
  })

  return (
    <>
      {projection === 'perspective' ? (
        <PerspectiveCamera
          ref={perspRef}
          makeDefault={editorCamActive}
          position={[5, 3.5, 5.5]}
          fov={45}
        />
      ) : (
        <OrthographicCamera
          ref={orthoRef}
          makeDefault={editorCamActive}
          position={[5, 3.5, 5.5]}
          zoom={110}
          near={-100}
          far={200}
        />
      )}
      <OrbitControls
        makeDefault
        enabled={editorCamActive}
        enableDamping={editorCamActive}
        enableRotate={!isPathStrokeTool(tool)}
        enableZoom={editorCamActive}
        enablePan={editorCamActive && !shiftHeld}
        dampingFactor={0.08}
        minPolarAngle={0.02}
        maxPolarAngle={Math.PI - 0.02}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
    </>
  )
}

const ZERO = new THREE.Vector3()
