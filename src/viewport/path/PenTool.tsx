import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Html, Line } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useEditorStore } from '../../state/useEditorStore'
import { usePathStore } from '../../state/usePathStore'
import { useSceneStore, type Vec3 } from '../../state/useSceneStore'
import {
  currentPathParentTransform,
  worldDirToPathLocal,
  worldHitToPathLocal,
  type PathSpaceScene,
} from '../../lib/pathSpaceBind'
import { localPointToWorld } from '../../lib/pathSpace'
import { constructionHeight, snapActive, snapToGridXZ } from '../../lib/penPlacement'
import { useEditorOnly } from '../../lib/editorOnly'
import { objectGroups } from '../SceneObjects'

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

/**
 * Pen tool with hybrid, depth-aware placement:
 *  - if a scene mesh is under the cursor, the point lands on that surface;
 *  - otherwise it lands on a construction plane at the previous anchor's
 *    height (the ground for the first point), nudged live with the wheel;
 *  - snapping locks empty-space clicks to the XZ grid.
 * A ghost marker, a vertical drop line and a live XYZ readout show exactly
 * where the point will land before the click.
 */
export function PenTool() {
  const activeAnchors = usePathStore((s) =>
    s.paths.find((p) => p.id === s.activePathId)?.anchors,
  )
  const [offset, setOffset] = useState(0)
  const [preview, setPreview] = useState<Preview | null>(null)
  const drag = useRef<{ id: string; origin: THREE.Vector3; planeY: number } | null>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  useEditorOnly(meshRef)

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
  const resolve = (e: { ray: THREE.Ray; ctrlKey: boolean }): Preview | null => {
    raycaster.set(e.ray.origin, e.ray.direction)
    const meshes = [...objectGroups.values()]
    const hits = meshes.length ? raycaster.intersectObjects(meshes, true) : []
    if (hits.length > 0) {
      const p = hits[0].point
      return { world: [p.x, p.y, p.z], surface: true }
    }
    plane.current.set(new THREE.Vector3(0, 1, 0), -planeY)
    if (!e.ray.intersectPlane(plane.current, hitPt.current)) return null
    let world: Vec3 = [hitPt.current.x, planeY, hitPt.current.z]
    const editor = useEditorStore.getState()
    if (snapActive(editor.snapEnabled, e.ctrlKey)) world = snapToGridXZ(world, editor.gridSize)
    return { world, surface: false }
  }

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const r = resolve(e)
    if (!r) return
    const path = usePathStore.getState()
    const local = worldHitToPathLocal(r.world, path.activePathId, pathScene())
    const id = path.addAnchor(local)
    drag.current = { id, origin: new THREE.Vector3(...r.world), planeY: r.world[1] }
    setOffset(0) // next point starts at the new anchor's height
    capturePointer(e)
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) {
      setPreview(resolve(e))
      return
    }
    // dragging out a Bézier handle on the horizontal plane at the anchor
    plane.current.set(new THREE.Vector3(0, 1, 0), -drag.current.planeY)
    if (!e.ray.intersectPlane(plane.current, hitPt.current)) return
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

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    drag.current = null
    releasePointer(e)
  }

  const onWheel = (e: ThreeEvent<WheelEvent>) => {
    e.stopPropagation()
    e.nativeEvent?.preventDefault?.()
    const editor = useEditorStore.getState()
    const step = snapActive(editor.snapEnabled, e.ctrlKey) ? editor.gridSize : 0.1
    setOffset((o) => o + (e.deltaY < 0 ? step : -step))
    setPreview(resolve(e))
  }

  return (
    <>
      <mesh
        ref={meshRef}
        rotation-x={-Math.PI / 2}
        position-y={planeY}
        userData={{ pickKind: 'pen', pickId: 'pen-plane' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setPreview(null)}
        onWheel={onWheel}
      >
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.05} depthWrite={false} side={THREE.DoubleSide} />
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
