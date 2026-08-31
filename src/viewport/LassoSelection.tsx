import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import {
  appendLassoPoint,
  collectLassoHits,
  projectObjectToPane,
  samplePathToPane,
  type LassoCandidate,
  type ScreenPoint,
} from '../lib/lasso'
import { hasLassoDrag, shouldArmLasso } from '../lib/lassoGesture'
import { lockOrbit, unlockOrbit } from '../lib/orbitLock'
import { currentPathParentTransform } from '../lib/pathSpaceBind'
import { tagHits } from '../lib/viewportPick'
import { isSceneEditing, pathGuidesVisible } from '../lib/workspaceChrome'
import { useEditorStore } from '../state/useEditorStore'
import { computeRects, paneAt, useLayoutStore, type Rect } from '../state/useLayoutStore'
import { usePathStore } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'
import { editorCameraRef } from './EditorCamera'
import { isTechMode } from './RenderPasses'
import { objectGroups } from './SceneObjects'

const DRAG_THRESHOLD = 5

interface Gesture {
  pointerId: number
  pane: Rect
  points: ScreenPoint[]
}

export function LassoSelection({
  onPoints,
  completedRef,
}: {
  onPoints: (points: ScreenPoint[], pane: Rect | null) => void
  completedRef: React.MutableRefObject<boolean>
}) {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null
  const gesture = useRef<Gesture | null>(null)

  useEffect(() => {
    const element = gl.domElement
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()

    const finish = (complete: boolean) => {
      const active = gesture.current
      if (!active) return
      gesture.current = null
      unlockOrbit()
      if (controls) controls.enabled = true

      const dragged = hasLassoDrag(active.points, DRAG_THRESHOLD)
      if (complete && dragged) {
        const camera = editorCameraRef.current
        if (camera) {
          camera.updateMatrixWorld(true)
          const editor = useEditorStore.getState()
          const sceneState = useSceneStore.getState()
          const pathState = usePathStore.getState()
          const candidates: LassoCandidate[] = []
          if (editor.showSceneObjects) {
            for (const object of sceneState.objects) {
              if (editor.hiddenIds.includes(`obj:${object.id}`)) continue
              const group = objectGroups.get(object.id)
              if (!group || !group.visible) continue
              candidates.push({
                id: `obj:${object.id}`,
                points: projectObjectToPane(group, camera, active.pane),
              })
            }
          }
          const pathScene = { objects: sceneState.objects, paths: pathState.paths }
          const curvesVisible =
            pathGuidesVisible(
              editor.playMode,
              editor.workspaceMode,
              useRigStore.getState().cameraKind,
            ) && !isTechMode(editor.viewMode)
          if (curvesVisible) {
            for (const path of pathState.paths) {
              if (editor.hiddenIds.includes(`path:${path.id}`)) continue
              candidates.push({
                id: `path:${path.id}`,
                points: samplePathToPane(
                  path,
                  camera,
                  active.pane,
                  currentPathParentTransform(path.id, pathScene),
                ),
              })
            }
          }
          editor.selectMany(collectLassoHits(active.points, candidates))
          completedRef.current = true
        }
      } else if (complete) {
        useEditorStore.getState().select(null)
      }
      onPoints([], null)
    }

    const onPointerDown = (event: PointerEvent) => {
      completedRef.current = false
      const bounds = element.getBoundingClientRect()
      const x = event.clientX - bounds.left
      const y = event.clientY - bounds.top
      const leaf = paneAt(x, y, bounds.width, bounds.height)
      const layout = useLayoutStore.getState()
      const pane =
        leaf &&
        computeRects(layout.root, { x: 0, y: 0, w: bounds.width, h: bounds.height }).leaves.get(
          leaf.id,
        )
      const camera = editorCameraRef.current
      if (!leaf || !pane || !camera) return

      ndc.set(
        ((x - pane.x) / Math.max(1, pane.w)) * 2 - 1,
        -((y - pane.y) / Math.max(1, pane.h)) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const background = tagHits(raycaster.intersectObjects(scene.children, true)).length === 0
      const editor = useEditorStore.getState()
      if (
        !shouldArmLasso({
          button: event.button,
          shiftKey: event.shiftKey,
          background,
          paneView: leaf.view,
          activePane: leaf.id === layout.activePaneId,
          tool: editor.tool,
          sceneEditing: isSceneEditing(editor.playMode, editor.workspaceMode),
          cameraView: editor.cameraView,
        })
      ) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      const start = { x: x - pane.x, y: y - pane.y }
      gesture.current = { pointerId: event.pointerId, pane, points: [start] }
      lockOrbit()
      if (controls) controls.enabled = false
      onPoints([start], pane)
    }

    const onPointerMove = (event: PointerEvent) => {
      const active = gesture.current
      if (!active || event.pointerId !== active.pointerId) return
      event.preventDefault()
      const bounds = element.getBoundingClientRect()
      const point = {
        x: event.clientX - bounds.left - active.pane.x,
        y: event.clientY - bounds.top - active.pane.y,
      }
      if (appendLassoPoint(active.points, point)) onPoints([...active.points], active.pane)
    }

    const onPointerUp = (event: PointerEvent) => {
      if (gesture.current?.pointerId !== event.pointerId) return
      finish(true)
    }
    const onPointerCancel = (event: PointerEvent) => {
      if (gesture.current?.pointerId !== event.pointerId) return
      finish(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(false)
    }

    element.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerCancel, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      element.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerCancel, true)
      window.removeEventListener('keydown', onKeyDown)
      finish(false)
    }
  }, [completedRef, controls, gl, onPoints, scene])

  return null
}

export function LassoOverlay({
  points,
  pane,
}: {
  points: ScreenPoint[]
  pane: Rect | null
}) {
  if (points.length < 2) return null
  return (
    <svg
      className="pointer-events-none absolute z-20"
      style={{ left: pane?.x ?? 0, top: pane?.y ?? 0, width: pane?.w, height: pane?.h }}
      role="status"
      aria-label="Selecting objects with lasso"
    >
      <polyline
        points={points.map((point) => `${point.x},${point.y}`).join(' ')}
        fill="rgb(255 255 255 / 0.08)"
        stroke="rgb(255 255 255 / 0.9)"
        strokeWidth="1.5"
        strokeDasharray="5 4"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
