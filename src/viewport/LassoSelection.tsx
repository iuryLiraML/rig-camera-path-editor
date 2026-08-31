import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import {
  appendLassoPoint,
  collectLassoResult,
  projectPathAnchorsToPane,
  projectObjectToPane,
  samplePathToPane,
  type LassoCandidate,
  type ProjectedAnchorCandidate,
  type ScreenPoint,
} from '../lib/lasso'
import {
  captureLassoSelectionSnapshot,
  hasLassoDrag,
  resolveLassoGestureFinish,
  shouldArmLasso,
  type LassoCancelReason,
  type LassoSelectionSnapshot,
} from '../lib/lassoGesture'
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
  snapshot: LassoSelectionSnapshot
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

    const restoreSelection = (snapshot: LassoSelectionSnapshot) => {
      usePathStore.getState().setSelectedAnchorRefs(snapshot.anchorRefs)
      usePathStore.setState({ activePathId: snapshot.activePathId })
      useEditorStore.setState({
        selection: snapshot.selection,
        selectionIds: [...snapshot.selectionIds],
      })
    }

    const finish = (
      outcome:
        | { kind: 'complete' }
        | { kind: 'cancel'; reason: LassoCancelReason },
    ) => {
      const active = gesture.current
      if (!active) return
      gesture.current = null
      unlockOrbit()
      if (controls) controls.enabled = true

      const dragged = hasLassoDrag(active.points, DRAG_THRESHOLD)
      if (outcome.kind === 'complete' && dragged) {
        const camera = editorCameraRef.current
        if (camera) {
          camera.updateMatrixWorld(true)
          const editor = useEditorStore.getState()
          const sceneState = useSceneStore.getState()
          const pathState = usePathStore.getState()
          const candidates: LassoCandidate[] = []
          const anchorCandidates: ProjectedAnchorCandidate[] = []
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
              const parent = currentPathParentTransform(path.id, pathScene)
              candidates.push({
                id: `path:${path.id}`,
                points: samplePathToPane(
                  path,
                  camera,
                  active.pane,
                  parent,
                ),
              })
              anchorCandidates.push(
                ...projectPathAnchorsToPane(path, camera, active.pane, parent),
              )
            }
          }
          const result = collectLassoResult(active.points, candidates, anchorCandidates)
          const resolution = resolveLassoGestureFinish(
            active.snapshot,
            {
              kind: 'complete',
              selectionIds: result
                .filter((hit) => hit.kind === 'top-level')
                .map((hit) => hit.id),
              anchorRefs: result
                .filter((hit) => hit.kind === 'anchor')
                .map((hit) => hit.ref),
            },
          )
          if (resolution.kind === 'apply') {
            editor.selectMany(resolution.selectionIds, resolution.anchorRefs)
          }
          completedRef.current = true
        }
      } else if (outcome.kind === 'complete') {
        useEditorStore.getState().select(null)
      } else {
        const resolution = resolveLassoGestureFinish(active.snapshot, outcome)
        if (resolution.kind === 'restore') restoreSelection(resolution.snapshot)
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
      const pathState = usePathStore.getState()
      gesture.current = {
        pointerId: event.pointerId,
        pane,
        points: [start],
        snapshot: captureLassoSelectionSnapshot({
          selection: editor.selection,
          selectionIds: editor.selectionIds,
          anchorRefs: pathState.selectedAnchorRefs,
          activePathId: pathState.activePathId,
        }),
      }
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
      finish({ kind: 'complete' })
    }
    const onPointerCancel = (event: PointerEvent) => {
      if (gesture.current?.pointerId !== event.pointerId) return
      finish({ kind: 'cancel', reason: 'pointercancel' })
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish({ kind: 'cancel', reason: 'escape' })
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
      finish({ kind: 'cancel', reason: 'teardown' })
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
