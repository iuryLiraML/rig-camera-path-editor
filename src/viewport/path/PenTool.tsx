import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Html, Line } from '@react-three/drei'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useEditorStore } from '../../state/useEditorStore'
import { usePathStore, type MotionPath } from '../../state/usePathStore'
import { useSceneStore, type Vec3 } from '../../state/useSceneStore'
import { computeRects, paneAt, useLayoutStore } from '../../state/useLayoutStore'
import {
  currentPathParentTransform,
  worldHitToPathLocal,
  type PathSpaceScene,
} from '../../lib/pathSpaceBind'
import { localPointToWorld, worldDirToLocal } from '../../lib/pathSpace'
import { constructionHeight, snapActive, snapToGridXZ } from '../../lib/penPlacement'
import {
  penStealsPointerButton,
  shouldHandlePenInput,
} from '../../lib/penGesture'
import { useEditorOnly } from '../../lib/editorOnly'
import { penStrokeIntent } from '../../lib/viewportPick'
import { cssPointFromClient, ndcFromPane } from '../../lib/pointerNdc'
import { pickBezier, viewDragPlane, type BezierHit } from '../../lib/bezierPicking'
import { moveBezierSegment, type HandleSide } from '../../lib/bezierEditing'
import { computeAutoHandles } from '../../lib/curve'
import { beginHistoryTransaction } from '../../lib/history'
import { lockOrbit, unlockOrbit } from '../../lib/orbitLock'
import { followActivePathIfFree } from '../../state/cameraPathLink'
import { objectGroups } from '../SceneObjects'
import { cinemaCameraRef } from '../rig/CinemaCamera'
import { isSpatialView, spatialCameras } from '../spatialViews'

export function capturePointer(e: ThreeEvent<PointerEvent>) {
  try {
    ;(e.target as Element).setPointerCapture(e.pointerId)
  } catch {
    /* synthetic/expired pointers */
  }
}

export function releasePointer(e: ThreeEvent<PointerEvent>) {
  try {
    ;(e.target as Element).releasePointerCapture(e.pointerId)
  } catch {
    /* pointer may already be inactive (touch lift, synthetic events) */
  }
}

function pathScene(): PathSpaceScene {
  return { objects: useSceneStore.getState().objects, paths: usePathStore.getState().paths }
}

type Preview = { world: Vec3; surface: boolean; label?: string }

// Front/Right rays are parallel to the ground. Use a facing plane through the
// last anchor there, so these views can author height instead of dropping clicks.
function drawingPlaneNormal(ray: THREE.Ray): THREE.Vector3 {
  if (Math.abs(ray.direction.y) < .2) {
    return Math.abs(ray.direction.x) > Math.abs(ray.direction.z)
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 0, 1)
  }
  return new THREE.Vector3(0, 1, 0)
}

function ignoreRaycast() {
  // Visual construction plane only — placement listens on the canvas.
}

function pointerPane(
  e: PointerEvent,
  el: HTMLCanvasElement,
  editorCam: THREE.Camera,
) {
  const css = cssPointFromClient(e.clientX, e.clientY, el)
  if (!css) return null
  const leaf = paneAt(css.x, css.y, css.width, css.height)
  const leaves = computeRects(useLayoutStore.getState().root, {
    x: 0,
    y: 0,
    w: css.width,
    h: css.height,
  }).leaves
  const pane = (leaf && leaves.get(leaf.id)) ?? { x: 0, y: 0, w: css.width, h: css.height }
  let cam = editorCam
  if (leaf && isSpatialView(leaf.view)) cam = spatialCameras[leaf.view]
  else if (leaf?.view === 'camera' && cinemaCameraRef.current) cam = cinemaCameraRef.current
  return { css, pane, cam, editable: leaf?.view !== 'camera' }
}

export function rayFromPointer(
  e: PointerEvent,
  el: HTMLCanvasElement,
  editorCam: THREE.Camera,
  raycaster: THREE.Raycaster,
): THREE.Ray | null {
  const surface = pointerPane(e, el, editorCam)
  if (!surface) return null
  const { css, pane, cam } = surface
  const ndc = ndcFromPane(css.x, css.y, pane)
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam)
  return raycaster.ray.clone()
}

const screenPt = new THREE.Vector3()

function worldToCss(
  world: Vec3,
  cam: THREE.Camera,
  pane: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  screenPt.set(world[0], world[1], world[2]).project(cam)
  if (screenPt.z < -1 || screenPt.z > 1) return { x: Infinity, y: Infinity }
  return {
    x: pane.x + ((screenPt.x + 1) / 2) * pane.w,
    y: pane.y + ((1 - screenPt.y) / 2) * pane.h,
  }
}

/**
 * Pen tool with hybrid, depth-aware placement:
 *  - if a scene mesh is under the cursor, the point lands on that surface;
 *  - otherwise it lands on a construction plane at the previous anchor's
 *    height (the ground for the first point);
 *  - snapping locks empty-space clicks to the XZ grid.
 * A ghost marker, a vertical drop line and a live XYZ readout show exactly
 * where the point will land before the click.
 *
 * Clicks are taken from the canvas, not the construction mesh: R3F's pick
 * filter drops unmarked helpers, and an existing path stroke would steal the
 * event so the pen looked broken.
 */
export function PenTool() {
  const activeAnchors = usePathStore((s) =>
    s.paths.find((p) => p.id === s.activePathId)?.anchors,
  )
  const selectedAnchorId = usePathStore(s => s.selectedAnchorId)
  const [offset, setOffset] = useState(0)
  const [preview, setPreview] = useState<Preview | null>(null)
  const tool = useEditorStore((s) => s.tool)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const continuing = useRef(false)
  const drag = useRef<{
    target: BezierHit | { kind: 'new'; id: string; side: HandleSide; local: Vec3 }
    snapshot: MotionPath; finish: (cancel?: boolean) => void
    plane: THREE.Plane; origin: THREE.Vector3; start: { x: number; y: number }
    camera: THREE.Camera; pane: { x: number; y: number; w: number; h: number }
    parent: ReturnType<typeof currentPathParentTransform>
    pointerId: number; moved: boolean; axis: 'x' | 'y' | 'z' | null; planeConstraint: boolean
  } | null>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const offsetRef = useRef(0)
  offsetRef.current = offset
  useEditorOnly(meshRef)

  const gl = useThree((s) => s.gl)
  const editorCam = useThree((s) => s.camera)
  const editorCamRef = useRef(editorCam)
  editorCamRef.current = editorCam
  const scene = useThree((s) => s.scene)

  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const plane = useRef(new THREE.Plane())
  const hitPt = useRef(new THREE.Vector3())

  // world-space height of the last placed anchor (altitude continuity)
  const base = useMemo(() => {
    const path = usePathStore.getState()
    const active = path.getPath(path.activePathId)
    const last = active?.anchors[0]?.id === path.selectedAnchorId ? active.anchors[0] : active?.anchors.at(-1)
    if (!last) return 0
    const parent = currentPathParentTransform(path.activePathId, pathScene())
    return parent ? localPointToWorld(last.position, parent)[1] : last.position[1]
  }, [activeAnchors, selectedAnchorId])

  const planeY = constructionHeight(base, offset)

  /** Resolve where a ray lands: scene surface first, else construction plane. */
  const resolve = (ray: THREE.Ray, ctrlKey: boolean): Preview | null => {
    raycaster.set(ray.origin, ray.direction)
    const meshes = [...objectGroups.values()]
    const hits = meshes.length ? raycaster.intersectObjects(meshes, true) : []
    if (hits.length > 0) {
      const p = hits[0].point
      return { world: [p.x, p.y, p.z], surface: true }
    }
    const paths = usePathStore.getState()
    const active = paths.getPath(paths.activePathId)
    const last = active?.anchors[0]?.id === paths.selectedAnchorId ? active.anchors[0] : active?.anchors.at(-1)
    const parent = currentPathParentTransform(paths.activePathId, pathScene())
    const lastWorld = last ? (parent ? localPointToWorld(last.position, parent) : last.position) : [0, 0, 0]
    const y = constructionHeight(lastWorld[1], offsetRef.current)
    plane.current.setFromNormalAndCoplanarPoint(drawingPlaneNormal(ray), new THREE.Vector3(lastWorld[0], y, lastWorld[2]))
    if (!ray.intersectPlane(plane.current, hitPt.current)) return null
    let world: Vec3 = [hitPt.current.x, hitPt.current.y, hitPt.current.z]
    const editor = useEditorStore.getState()
    if (snapActive(editor.snapEnabled, ctrlKey)) world = snapToGridXZ(world, editor.gridSize)
    return { world, surface: false }
  }

  const resolveRef = useRef(resolve)
  resolveRef.current = resolve

  useEffect(() => {
    const el = gl.domElement
    const consume = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation() }
    const editable = () => {
      const state = usePathStore.getState()
      return shouldHandlePenInput() && !useEditorStore.getState().hiddenIds.includes(`path:${state.activePathId}`)
    }
    const targetAt = (surface: NonNullable<ReturnType<typeof pointerPane>>) => {
      const state = usePathStore.getState()
      const active = state.getPath(state.activePathId)
      if (!active) return null
      const parent = currentPathParentTransform(active.id, pathScene())
      const showSelected = tool === 'pen' || useEditorStore.getState().selection === 'camera-path'
      const ids = new Set(state.showAllHandles ? active.anchors.map(a => a.id) : showSelected ? state.selectedAnchorIds : [])
      return pickBezier(active, surface.css, local => worldToCss(parent ? localPointToWorld(local, parent) : local, surface.cam, surface.pane), ids)
    }
    const end = (cancel = false) => {
      const session = drag.current
      if (!session) return
      drag.current = null
      session.finish(cancel)
      unlockOrbit()
      if (controls) controls.enabled = true
      usePathStore.getState().setPendingHandle(null)
      try { el.releasePointerCapture(session.pointerId) } catch { /* capture already lost */ }
      el.style.cursor = tool === 'pen' ? 'crosshair' : ''
    }
    const begin = (e: PointerEvent, surface: NonNullable<ReturnType<typeof pointerPane>>, target: NonNullable<typeof drag.current>['target'], snapshot: MotionPath, finish: (cancel?: boolean) => void) => {
      const parent = currentPathParentTransform(snapshot.id, pathScene())
      const world = parent ? localPointToWorld(target.local, parent) : target.local
      const plane = viewDragPlane(surface.cam, world)
      const ray = rayFromPointer(e, el, surface.cam, raycaster)
      const origin = ray?.intersectPlane(plane, new THREE.Vector3()) ?? new THREE.Vector3(...world)
      drag.current = { target, snapshot, finish, plane, origin, start: { x: e.clientX, y: e.clientY }, camera: surface.cam.clone(), pane: surface.pane, parent, pointerId: e.pointerId, moved: false, axis: null, planeConstraint: false }
      lockOrbit()
      if (controls) controls.enabled = false
      try { el.setPointerCapture(e.pointerId) } catch { /* expired pointer */ }
      setPreview(null)
    }
    const closesStroke = (target: BezierHit) => {
      const state = usePathStore.getState(), active = state.getPath(state.activePathId)
      if (target.kind !== 'anchor' || tool !== 'pen' || !continuing.current || !active || active.closed || active.anchors.length < 3) return false
      const first = active.anchors[0].id, last = active.anchors.at(-1)!.id
      return (state.selectedAnchorId === last && target.id === first) || (state.selectedAnchorId === first && target.id === last)
    }
    const onDown = (e: PointerEvent) => {
      if (!penStealsPointerButton(e.button) || !editable() || drag.current) return
      const surface = pointerPane(e, el, editorCamRef.current)
      if (!surface?.editable) return
      const state = usePathStore.getState()
      const active = state.getPath(state.activePathId)
      if (!active) return
      const target = targetAt(surface)
      if (target) {
        if (target.kind === 'segment' && tool === 'select' && !e.ctrlKey) return
        consume(e)
        if (closesStroke(target)) {
          const finish = beginHistoryTransaction()
          finishPen(true)
          finish()
          continuing.current = false
          return
        }
        useEditorStore.getState().select('camera-path')
        const finish = beginHistoryTransaction()
        if (target.kind === 'segment' && e.ctrlKey) {
          const id = state.splitSegment(target.index, target.t)
          if (!id) { finish(); return }
          begin(e, surface, { kind: 'new', id, side: 'out', local: target.local }, active, finish)
        } else if (target.kind === 'segment') {
          begin(e, surface, target, active, finish)
        } else {
          const pending = state.pendingHandle
          state.selectAnchor(target.id, target.kind === 'anchor' && e.shiftKey, target.kind === 'anchor' && !e.shiftKey)
          if (target.kind === 'handle') state.selectHandle(target.side)
          const pulling = target.kind === 'anchor' && (pending || e.altKey)
          const hit: BezierHit = pulling ? { kind: 'handle', id: target.id, side: pending ?? 'out', local: target.local } : target
          if (pulling) state.selectHandle(pending ?? 'out')
          begin(e, surface, hit, active, finish)
        }
        continuing.current = false
        return
      }
      if (tool !== 'pen' || active.closed) return
      const ray = rayFromPointer(e, el, editorCamRef.current, raycaster)
      if (!ray) return
      raycaster.set(ray.origin, ray.direction)
      if (penStrokeIntent(raycaster.intersectObjects(scene.children, true)).action === 'ignore') return
      const r = resolveRef.current(ray, e.ctrlKey)
      if (!r) return
      // Interior-point selection edits the curve; continue only from an endpoint.
      if (state.selectedAnchorId && active.anchors.length > 1 && state.selectedAnchorId !== active.anchors[0].id && state.selectedAnchorId !== active.anchors.at(-1)!.id) return
      consume(e)
      const finish = beginHistoryTransaction()
      const local = worldHitToPathLocal(r.world, active.id, pathScene())
      const atStart = active.anchors.length > 1 && state.selectedAnchorId === active.anchors[0].id
      const id = state.extendAnchor(local, atStart)
      useEditorStore.getState().select('camera-path')
      if (active.anchors.length === 0) followActivePathIfFree()
      begin(e, surface, { kind: 'new', id, side: atStart ? 'in' : 'out', local }, active, finish)
      continuing.current = true
      setOffset(0)
    }
    const onMove = (e: PointerEvent) => {
      if (!editable()) { end(true); setPreview(null); return }
      const session = drag.current
      if (!session) {
        const surface = pointerPane(e, el, editorCamRef.current)
        if (!surface?.editable) { setPreview(null); return }
        const target = targetAt(surface)
        const closing = target && closesStroke(target)
        el.style.cursor = closing ? 'alias' : target ? target.kind === 'segment' && e.ctrlKey ? 'copy' : 'grab' : tool === 'pen' ? 'crosshair' : ''
        el.title = closing ? 'Close curve' : target ? target.kind === 'handle' ? `Drag ${target.side === 'in' ? 'incoming' : 'outgoing'} handle · Alt: independent · X/Y/Z: constrain` : target.kind === 'anchor' ? 'Drag point · Alt-drag: pull handle · Shift-click: select multiple' : 'Drag segment · Ctrl-click: insert point' : ''
        const paths = usePathStore.getState(), active = paths.getPath(paths.activePathId)
        const interior = active && paths.selectedAnchorId && paths.selectedAnchorId !== active.anchors[0]?.id && paths.selectedAnchorId !== active.anchors.at(-1)?.id
        if (closing && target) {
          const parent = currentPathParentTransform(paths.activePathId, pathScene())
          setPreview({ world: parent ? localPointToWorld(target.local, parent) : target.local, surface: false, label: 'Close curve' })
        } else if (tool === 'pen' && !target && (active?.closed || interior)) {
          el.style.cursor = 'default'
          el.title = active?.closed ? 'Reopen the curve in the inspector to add points' : 'Select an endpoint or use Continue start / Continue end'
          setPreview(null)
        } else if (tool === 'pen' && !target) {
          const ray = rayFromPointer(e, el, editorCamRef.current, raycaster)
          setPreview(ray ? resolveRef.current(ray, e.ctrlKey) : null)
        } else setPreview(null)
        return
      }
      if (session.pointerId !== e.pointerId) return
      consume(e)
      if (!session.moved && Math.hypot(e.clientX - session.start.x, e.clientY - session.start.y) < 4) return
      session.moved = true
      const css = cssPointFromClient(e.clientX, e.clientY, el)
      if (!css) return
      const ndc = ndcFromPane(css.x, css.y, session.pane)
      raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), session.camera)
      const hit = raycaster.ray.intersectPlane(session.plane, new THREE.Vector3())
      if (!hit) return
      const delta = hit.sub(session.origin)
      if (session.axis) {
        const component = session.axis === 'x' ? 0 : session.axis === 'y' ? 1 : 2
        for (let i = 0; i < 3; i++) if (session.planeConstraint ? i === component : i !== component) delta.setComponent(i, 0)
      }
      const localDelta = session.parent ? worldDirToLocal(delta.toArray(), session.parent) : delta.toArray()
      const state = usePathStore.getState()
      const target = session.target
      if (target.kind === 'segment') {
        state.setPathData(session.snapshot.id, { anchors: moveBezierSegment(session.snapshot, target.index, target.t, localDelta) })
      } else if (target.kind === 'anchor') {
        const ids = new Set(state.selectedAnchorIds)
        state.setPathData(session.snapshot.id, { anchors: session.snapshot.anchors.map(a => ids.has(a.id) ? { ...a, position: a.position.map((v, i) => v + localDelta[i]) as Vec3 } : a) })
      } else {
        const current = state.getPath(session.snapshot.id)!
        const original = computeAutoHandles(session.snapshot.anchors, session.snapshot.closed, session.snapshot.rounding).find(a => a.id === target.id)
        const origin = target.kind === 'new' || !original ? [0, 0, 0] : target.local.map((v, i) => v - original.position[i])
        const value = origin.map((v, i) => v + localDelta[i]) as Vec3
        // Reapply to the baseline, never to the previous frame's constraints.
        if (target.kind !== 'new') state.setPathData(session.snapshot.id, { anchors: session.snapshot.anchors })
        state.setHandle(target.id, target.side, value, e.altKey)
        if (target.kind === 'new') {
          state.selectHandle(target.side)
          state.setAnchorTangent(target.id, 'mirrored')
          state.setAnchorTangent(target.id, 'aligned')
        }
        if (!current) end(true)
      }
      el.style.cursor = 'grabbing'
    }
    const onUp = (e: PointerEvent) => { if (drag.current?.pointerId === e.pointerId) { consume(e); end() } }
    const onCancel = () => end(true)
    const onKey = (e: KeyboardEvent) => {
      if (!drag.current && e.key === 'Escape' && usePathStore.getState().pendingHandle) {
        consume(e)
        usePathStore.getState().setPendingHandle(null)
        return
      }
      if (!drag.current) return
      if (e.key === 'Escape') { consume(e); end(true) }
      else if (e.key === 'Enter') { consume(e); end() }
      else if (['x', 'y', 'z'].includes(e.key.toLowerCase())) { consume(e); const axis = e.key.toLowerCase() as 'x' | 'y' | 'z'; drag.current.axis = drag.current.axis === axis && drag.current.planeConstraint === e.shiftKey ? null : axis; drag.current.planeConstraint = e.shiftKey }
    }
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('pointermove', onMove, true)
    el.addEventListener('pointerup', onUp, true)
    el.addEventListener('pointercancel', onCancel)
    el.addEventListener('lostpointercapture', onCancel)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onCancel)
    return () => {
      end(true)
      el.style.cursor = ''
      el.title = ''
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('pointermove', onMove, true)
      el.removeEventListener('pointerup', onUp, true)
      el.removeEventListener('pointercancel', onCancel)
      el.removeEventListener('lostpointercapture', onCancel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onCancel)
    }
  }, [gl, scene, raycaster, tool, controls])

  return (
    <>
      {tool === 'pen' && <mesh ref={meshRef} rotation-x={-Math.PI / 2} position-y={planeY} raycast={ignoreRaycast}>
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial
          color="#3b82f6"
          transparent
          opacity={0.05}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>}
      {tool === 'pen' && preview && !drag.current && <PenGhost preview={preview} />}
    </>
  )
}

const GROUND = '#4a7dff'
const SURFACE = '#59c05a'

function PenGhost({ preview }: { preview: Preview }) {
  const [x, y, z] = preview.world
  const color = preview.surface ? SURFACE : GROUND
  return (
    <group>
      <mesh position={[x, y, z]} renderOrder={20}>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
      </mesh>
      {Math.abs(y) > 1e-4 && (
        <Line
          points={[
            [x, y, z],
            [x, 0, z],
          ]}
          color={color}
          lineWidth={1}
          dashed
          dashSize={0.08}
          gapSize={0.06}
          transparent
          opacity={0.55}
          depthTest={false}
        />
      )}
      <mesh position={[x, 0, z]} rotation-x={-Math.PI / 2} renderOrder={20}>
        <ringGeometry args={[0.03, 0.05, 16]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      {/* `center` puts drei's wrapper exactly on the cursor and it inherits
          `pointer-events: auto`, so a 153×20 div sat over the point and ate the
          click that places it: hover, press, and the press hit the readout
          instead of the canvas. The inner div being inert was not enough, and
          drei's own `pointerEvents` prop only reaches its transform path, which
          this is not — the wrapper takes it through `style`. A preview must
          never be a click target. */}
      <Html
        position={[x, y, z]}
        center
        distanceFactor={8}
        zIndexRange={[20, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div
          style={{
            transform: 'translateY(-1.4rem)',
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(17,17,20,0.82)',
            color: '#e8e8ea',
            font: '11px/1.3 ui-monospace, monospace',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            border: `1px solid ${color}`,
          }}
        >
          {preview.label ?? `x ${x.toFixed(2)}  y ${y.toFixed(2)}  z ${z.toFixed(2)}`}
        </div>
      </Html>
    </group>
  )
}

/** Finish drawing: close the loop if asked, then go back to select. */
export function finishPen(close = false) {
  const path = usePathStore.getState()
  const active = path.getPath(path.activePathId)
  if (close && (active?.anchors.length ?? 0) > 2) path.setClosed(true)
  useEditorStore.getState().setTool('select')
  useEditorStore.getState().select('camera-path')
}
