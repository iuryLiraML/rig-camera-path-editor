import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useEditorStore } from '../state/useEditorStore'
import { computeRects, leafList, useLayoutStore, type PaneView, type Rect } from '../state/useLayoutStore'
import { editorOnlySet } from '../lib/editorOnly'
import { cinemaCameraRef } from './rig/CinemaCamera'
import { clearRegion, renderSceneRegion } from './RenderPasses'
import { ensureSpatialCamera, isSpatialView, spatialCameras } from './spatialViews'
import { freeAreaRect, intersectRect, viewportInsets } from '../ui/viewportInsets'

/**
 * Owns the whole edit-mode render when the viewport is split into >1 pane.
 * Each leaf is rendered through its own camera into a scissored region (reusing
 * the PiP's renderSceneRegion). The editor pane shows gizmos; front/top/right
 * keep an independent orbit camera. In single-pane mode this is a no-op.
 */
export function PaneCompositor() {
  useFrame((state) => {
    const { gl, scene, camera, size } = state
    const editor = useEditorStore.getState()
    if (editor.playMode) return // play mode always renders full-frame (CameraPreview)

    const { root, activePaneId } = useLayoutStore.getState()
    const leaves = leafList(root)
    // keep the editor camera's resting aspect correct for single-pane / after-split
    if (leaves.length <= 1) {
      const cam = camera as THREE.PerspectiveCamera
      const aspect = size.width / Math.max(1, size.height)
      if (cam.isPerspectiveCamera && Math.abs(cam.aspect - aspect) > 1e-4) {
        cam.aspect = aspect
        cam.updateProjectionMatrix()
      }
      return
    }

    const outline = editor.viewMode === 'outline'
    const rects = computeRects(root, { x: 0, y: 0, w: size.width, h: size.height }).leaves
    // a camera pane is there to show the shot, so it must not be half-hidden
    // behind a panel the way the spatial views can afford to be
    const free = freeAreaRect(
      viewportInsets(editor.panelTab, size.width, true, size.height, editor.timelineHeight),
      size.height,
    )

    // GL scissor uses bottom-up y; DOM rects are top-left
    const toGL = (r: Rect) => ({ x: r.x, y: size.height - (r.y + r.h), w: r.w, h: r.h })

    const cinema = cinemaCameraRef.current

    for (const leaf of leaves) {
      let r = rects.get(leaf.id)
      if (!r || r.w < 4 || r.h < 4) continue
      if (leaf.view === 'camera' && leaf.id !== activePaneId) {
        const visible = intersectRect(r, free)
        if (visible.w >= 40 && visible.h >= 40) {
          const full = toGL(r)
          clearRegion(gl, scene as THREE.Scene, full.x, full.y, full.w, full.h)
          r = visible
        }
      }
      const g = toGL(r)
      const aspect = r.w / Math.max(1, r.h)

      if (leaf.id === activePaneId) {
        const cam = camera as THREE.PerspectiveCamera
        if (cam.isPerspectiveCamera && Math.abs(cam.aspect - aspect) > 1e-4) {
          cam.aspect = aspect
          cam.updateProjectionMatrix()
        }
        renderSceneRegion(gl, scene as THREE.Scene, camera, g.x, g.y, g.w, g.h, outline)
        continue
      }

      const view = leaf.view as Exclude<PaneView, 'editor'>
      let cam: THREE.Camera | null = null
      if (view === 'camera') {
        cam = cinema
        if (cinema) {
          cinema.aspect = aspect
          cinema.updateProjectionMatrix()
        }
      } else if (isSpatialView(view)) {
        ensureSpatialCamera(view, aspect)
        cam = spatialCameras[view]
      }
      // no cinema camera yet (no path drawn): clear, don't leave stale pixels
      if (!cam) {
        clearRegion(gl, scene as THREE.Scene, g.x, g.y, g.w, g.h)
        continue
      }

      const restore: [THREE.Object3D, boolean][] = []
      editorOnlySet.forEach((obj) => {
        restore.push([obj, obj.visible])
        obj.visible = false
      })
      renderSceneRegion(gl, scene as THREE.Scene, cam, g.x, g.y, g.w, g.h, outline)
      restore.forEach(([obj, visible]) => {
        obj.visible = visible
      })
    }

    // restore the full viewport for the next consumer / frame
    gl.setViewport(0, 0, size.width, size.height)
    gl.setScissorTest(false)
  }, 1)

  return null
}
