import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Html, Line } from '@react-three/drei'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useEditorStore } from '../../state/useEditorStore'
import { usePathStore } from '../../state/usePathStore'
import { useSceneStore, type Vec3 } from '../../state/useSceneStore'
import { computeRects, paneAt, useLayoutStore } from '../../state/useLayoutStore'
import {
  currentPathParentTransform,
  worldDirToPathLocal,
  worldHitToPathLocal,
  type PathSpaceScene,
} from '../../lib/pathSpaceBind'
import { localPointToWorld } from '../../lib/pathSpace'
import { constructionHeight, snapActive, snapToGridXZ } from '../../lib/penPlacement'
import { useEditorOnly } from '../../lib/editorOnly'
import { penShouldPlace } from '../../lib/viewportPick'
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

type Preview = { world: Vec3; surface: boolean }

function ignoreRaycast() {
  // Visual construction plane only — placement listens on the canvas.
}

export function rayFromPointer(
  e: PointerEvent,
  el: HTMLCanvasElement,
  editorCam: THREE.Camera,
  raycaster: THREE.Raycaster,
): THREE.Ray | null {
  const rect = el.getBoundingClientRect()
  const w = rect.width
  const h = rect.height
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  if (x < 0 || y < 0 || x > w || y > h) return null
  const leaf = paneAt(x, y, w, h)
  const leaves = computeRects(useLayoutStore.getState().root, { x: 0, y: 0, w, h }).leaves
  const pane = (leaf && leaves.get(leaf.id)) ?? { x: 0, y: 0, w, h }
  const ndc = new THREE.Vector2(
    ((x - pane.x) / Math.max(1, pane.w)) * 2 - 1,
    -((y - pane.y) / Math.max(1, pane.h)) * 2 + 1,
  )
  let cam = editorCam
  if (leaf && isSpatialView(leaf.view)) cam = spatialCameras[leaf.view]
  else if (leaf?.view === 'camera' && cinemaCameraRef.current) cam = cinemaCameraRef.current
  raycaster.setFromCamera(ndc, cam)
  return raycaster.ray.clone()
}

/**
 * Pen tool with hybrid, depth-aware placement:
 *  - if a scene mesh is under the cursor, the point lands on that surface;
 *  - otherwise it lands on a construction plane at the previous anchor's
 *    height (the ground for the first point), nudged live with the wheel;
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
  const [offset, setOffset] = useState(0)
  const [preview, setPreview] = useState<Preview | null>(null)
  const drag = useRef<{ id: string; origin: THREE.Vector3; planeY: number } | null>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const offsetRef = useRef(0)
  offsetRef.current = offset
  useEditorOnly(meshRef)

  const gl = useThree((s) => s.gl)
  const editorCam = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)

  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const plane = useRef(new THREE.Plane())
  const hitPt = useRef(new THREE.Vector3())

  // world-space height of the last placed anchor (altitude continuity)
  const base = useMemo(() => {
    const path = usePathStore.getState()
    const active = path.getPath(path.activePathId)
    const last = active?.anchors[active.anchors.length - 1]
    if (!last) return 0
    const parent = currentPathParentTransform(path.activePathId, pathScene())
    return parent ? localPointToWorld(last.position, parent)[1] : last.position[1]
  }, [activeAnchors])

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
    const y = constructionHeight(base, offsetRef.current)
    plane.current.set(new THREE.Vector3(0, 1, 0), -y)
    if (!ray.intersectPlane(plane.current, hitPt.current)) return null
    let world: Vec3 = [hitPt.current.x, y, hitPt.current.z]
    const editor = useEditorStore.getState()
    if (snapActive(editor.snapEnabled, ctrlKey)) world = snapToGridXZ(world, editor.gridSize)
    return { world, surface: false }
  }

  useEffect(() => {
    const el = gl.domElement

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const ray = rayFromPointer(e, el, editorCam, raycaster)
      if (!ray) return
      raycaster.set(ray.origin, ray.direction)
      const hits = raycaster.intersectObjects(scene.children, true)
      if (!penShouldPlace(hits)) return
      const r = resolve(ray, e.ctrlKey)
      if (!r) return
      e.preventDefault()
      const path = usePathStore.getState()
      const local = worldHitToPathLocal(r.world, path.activePathId, pathScene())
      const id = path.addAnchor(local)
      drag.current = { id, origin: new THREE.Vector3(...r.world), planeY: r.world[1] }
      setOffset(0)
      setPreview(null)
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* already captured */
      }
    }

    const onMove = (e: PointerEvent) => {
      const ray = rayFromPointer(e, el, editorCam, raycaster)
      if (!ray) {
        if (!drag.current) setPreview(null)
        return
      }
      if (!drag.current) {
        setPreview(resolve(ray, e.ctrlKey))
        return
      }
      plane.current.set(new THREE.Vector3(0, 1, 0), -drag.current.planeY)
      if (!ray.intersectPlane(plane.current, hitPt.current)) return
      const out = hitPt.current.clone().sub(drag.current.origin)
      if (out.length() > 0.05) {
        const local = worldDirToPathLocal(
          [out.x, out.y, out.z],
          usePathStore.getState().activePathId,
          pathScene(),
        )
        usePathStore.getState().setHandleOut(drag.current.id, local, true)
      }
    }

    const onUp = (e: PointerEvent) => {
      drag.current = null
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
    }

    const onWheel = (e: WheelEvent) => {
      const ray = rayFromPointer(e as unknown as PointerEvent, el, editorCam, raycaster)
      if (!ray) return
      e.preventDefault()
      const editor = useEditorStore.getState()
      const step = snapActive(editor.snapEnabled, e.ctrlKey) ? editor.gridSize : 0.1
      setOffset((o) => o + (e.deltaY < 0 ? step : -step))
      setPreview(resolve(ray, e.ctrlKey))
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
    }
    // resolve closes over base; re-bind when the last anchor height changes
  }, [gl, editorCam, scene, raycaster, base])

  return (
    <>
      <mesh ref={meshRef} rotation-x={-Math.PI / 2} position-y={planeY} raycast={ignoreRaycast}>
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial
          color="#3b82f6"
          transparent
          opacity={0.05}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {preview && !drag.current && <PenGhost preview={preview} />}
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
      <Html position={[x, y, z]} center distanceFactor={8} zIndexRange={[20, 0]}>
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
          {`x ${x.toFixed(2)}  y ${y.toFixed(2)}  z ${z.toFixed(2)}`}
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
