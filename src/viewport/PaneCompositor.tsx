import { useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useEditorStore } from '../state/useEditorStore'
import { computeRects, leafList, useLayoutStore, type PaneView, type Rect } from '../state/useLayoutStore'
import { editorOnlySet } from '../lib/editorOnly'
import { cinemaCameraRef } from './rig/CinemaCamera'
import { renderSceneRegion } from './RenderPasses'
import { sceneBounds } from './SceneObjects'

/** axis directions for the fixed views (slight y-bias so they don't read flat) */
const VIEW_DIRS: Record<'front' | 'top' | 'right', [number, number, number]> = {
  front: [0, 0.12, 1],
  top: [0.001, 1, 0.001],
  right: [1, 0.12, 0],
}

const _center = new THREE.Vector3()
const _size = new THREE.Vector3()
const _dir = new THREE.Vector3()

/** Frame a fixed-view camera on the whole scene. */
function frameFixed(cam: THREE.PerspectiveCamera, view: 'front' | 'top' | 'right', aspect: number) {
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
}

/**
 * Owns the whole edit-mode render when the viewport is split into >1 pane.
 * Each leaf is rendered through its own camera into a scissored region (reusing
 * the PiP's renderSceneRegion). The active pane shows the interactive editor
 * camera with helpers visible; the others are clean fixed views. In single-pane
 * mode this is a no-op (drei's GizmoHelper + CameraPreview keep the old path).
 */
export function PaneCompositor() {
  const fixedCams = useMemo(
    () => ({
      front: new THREE.PerspectiveCamera(40, 1, 0.05, 200),
      top: new THREE.PerspectiveCamera(40, 1, 0.05, 200),
      right: new THREE.PerspectiveCamera(40, 1, 0.05, 200),
    }),
    [],
  )

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

    // GL scissor uses bottom-up y; DOM rects are top-left
    const toGL = (r: Rect) => ({ x: r.x, y: size.height - (r.y + r.h), w: r.w, h: r.h })

    const cinema = cinemaCameraRef.current

    for (const leaf of leaves) {
      const r = rects.get(leaf.id)
      if (!r || r.w < 4 || r.h < 4) continue
      const g = toGL(r)
      const aspect = r.w / Math.max(1, r.h)

      if (leaf.id === activePaneId) {
        // interactive pane: editor camera, helpers visible
        const cam = camera as THREE.PerspectiveCamera
        if (cam.isPerspectiveCamera && Math.abs(cam.aspect - aspect) > 1e-4) {
          cam.aspect = aspect
          cam.updateProjectionMatrix()
        }
        renderSceneRegion(gl, scene as THREE.Scene, camera, g.x, g.y, g.w, g.h, outline)
        continue
      }

      // fixed pane: hide editor-only helpers, pick the view's camera
      const view = leaf.view as Exclude<PaneView, 'editor'>
      let cam: THREE.Camera | null = null
      if (view === 'camera') {
        cam = cinema
        if (cinema) {
          cinema.aspect = aspect
          cinema.updateProjectionMatrix()
        }
      } else {
        frameFixed(fixedCams[view], view, aspect)
        cam = fixedCams[view]
      }
      if (!cam) continue

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
