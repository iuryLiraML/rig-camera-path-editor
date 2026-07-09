import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useEditorStore } from '../state/useEditorStore'
import { sceneBounds } from './SceneObjects'

/** distance of the initial framing — the zoom readout's 100% reference */
const DEFAULT_DIST = 7.9
const ORTHO_DEFAULT_ZOOM = 110

const VIEW_DIRS = {
  front: new THREE.Vector3(0, 0.12, 1),
  top: new THREE.Vector3(0.001, 1, 0.001),
  right: new THREE.Vector3(1, 0.12, 0),
}

export function EditorCamera() {
  const projection = useEditorStore((s) => s.projection)
  const tool = useEditorStore((s) => s.tool)
  const playMode = useEditorStore((s) => s.playMode)
  const cameraView = useEditorStore((s) => s.cameraView)
  const frameRequest = useEditorStore((s) => s.frameRequest)
  const viewRequest = useEditorStore((s) => s.viewRequest)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const camera = useThree((s) => s.camera)
  const editorCamActive = !playMode && !cameraView
  const lastZoom = useRef(100)

  // F — frame everything in the scene
  useEffect(() => {
    if (frameRequest === 0 || !controls) return
    const box = sceneBounds()
    if (!box) return
    const center = box.getCenter(new THREE.Vector3())
    const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1
    const direction = camera.position.clone().sub(controls.target).normalize()
    controls.target.copy(center)
    camera.position.copy(center.clone().add(direction.multiplyScalar(radius * 2.4)))
    controls.update()
  }, [frameRequest, controls, camera])

  // quick views — snap the camera to an axis, keeping the current distance
  useEffect(() => {
    if (!viewRequest || !controls) return
    const box = sceneBounds()
    const center = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0.8, 0)
    const dist = Math.max(2, camera.position.distanceTo(controls.target))
    const dir = VIEW_DIRS[viewRequest.view].clone().normalize()
    camera.position.copy(center.clone().add(dir.multiplyScalar(dist)))
    controls.target.copy(center)
    controls.update()
  }, [viewRequest, controls, camera])

  // live zoom readout for the toolbar (only writes when the integer changes)
  useFrame(() => {
    if (!editorCamActive) return
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
        <PerspectiveCamera makeDefault={editorCamActive} position={[5, 3.5, 5.5]} fov={45} />
      ) : (
        <OrthographicCamera
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
        enableRotate={tool !== 'pen'}
        enableDamping
        dampingFactor={0.08}
        target={[0, 0.8, 0]}
        maxPolarAngle={Math.PI * 0.55}
      />
    </>
  )
}

const ZERO = new THREE.Vector3()
