import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { useEditorStore } from '../state/useEditorStore'
import { cameraReady } from '../state/cameraPathLink'
import { useLayoutStore } from '../state/useLayoutStore'
import { editorOnlySet } from '../lib/editorOnly'
import { cinemaCameraRef } from './rig/CinemaCamera'
import { editorCameraRef } from './EditorCamera'
import { renderOutline, renderSceneRegion } from './RenderPasses'

/**
 * Renders the cinema-camera picture-in-picture into a scissored corner of the
 * main canvas, and owns the full-frame render in play mode and outline mode.
 * Runs at priority 2 — after drei's Hud pass (priority 1), which draws the
 * main scene + orbit gizmo. Depth/normals modes ride on scene.overrideMaterial
 * (set by ViewModeController), so the Hud pass already shows them; outline
 * needs its own offscreen pass and overwrites the frame here.
 */
export function CameraPreview() {
  useFrame((state) => {
    const { gl, scene, camera, size } = state
    const editor = useEditorStore.getState()
    const outline = editor.viewMode === 'outline'

    if (editor.playMode) {
      if (outline) renderOutline(gl, scene as THREE.Scene, camera, 0, 0, size.width, size.height)
      else gl.render(scene, camera)
      return
    }

    // in split layout the PaneCompositor owns the whole edit-mode render
    if (useLayoutStore.getState().paneCount() > 1) return

    // edit mode + outline: overwrite the Hud's clay frame with the lineart pass
    if (outline) {
      renderOutline(gl, scene as THREE.Scene, camera, 0, 0, size.width, size.height)
    }

    const cam = cinemaCameraRef.current
    if (editor.cameraView) {
      // the corner gizmo (whose Hud pass draws the main frame in edit mode) is
      // unmounted while looking through, so own the full-frame render here
      if (!outline) gl.render(scene, camera)
      // keep the PiP, but show the editor so the user still has a scene view
      // (the cinema body would be hidden in the main viewport)
      const editorCam = editorCameraRef.current
      if (!editor.showPreview || !editorCam) return
      const pip = editor.pipRect
      const pw = Math.round(size.width * pip.fraction)
      const ph = Math.round(size.height * pip.fraction)
      const x = size.width - pw - pip.right
      const y = pip.bottom
      if (pw < 40 || ph < 40 || x < 0 || y + ph > size.height) return
      const aspect = pw / ph
      const persp = editorCam as THREE.PerspectiveCamera
      if ('aspect' in persp && Math.abs(persp.aspect - aspect) > 1e-4) {
        persp.aspect = aspect
        persp.updateProjectionMatrix()
      }
      renderSceneRegion(gl, scene as THREE.Scene, editorCam, x, y, pw, ph, outline)
      gl.setViewport(0, 0, size.width, size.height)
      return
    }
    if (!editor.showPreview || !cam || !cameraReady()) return

    const pip = editor.pipRect
    const pw = Math.round(size.width * pip.fraction)
    const ph = Math.round(size.height * pip.fraction)
    const x = size.width - pw - pip.right
    const y = pip.bottom
    if (pw < 40 || ph < 40 || x < 0 || y + ph > size.height) return

    // own the cinema camera's aspect here — a split "camera" pane may have
    // left it set to that pane's aspect (the PiP region shares the canvas's)
    const aspect = pw / ph
    if (Math.abs(cam.aspect - aspect) > 1e-4) {
      cam.aspect = aspect
      cam.updateProjectionMatrix()
    }

    const restore: [THREE.Object3D, boolean][] = []
    editorOnlySet.forEach((obj) => {
      restore.push([obj, obj.visible])
      obj.visible = false
    })

    renderSceneRegion(gl, scene as THREE.Scene, cam, x, y, pw, ph, outline)
    gl.setViewport(0, 0, size.width, size.height)

    restore.forEach(([obj, visible]) => {
      obj.visible = visible
    })
  }, 2)

  return null
}
