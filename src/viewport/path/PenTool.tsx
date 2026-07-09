import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { useEditorStore } from '../../state/useEditorStore'
import { usePathStore } from '../../state/usePathStore'
import { useEditorOnly } from '../../lib/editorOnly'

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

/**
 * Plane at drawPlaneY that catches clicks while the pen tool is active.
 * Click = corner anchor; click+drag pulls out mirrored Bézier handles.
 * Points come from a mathematical plane intersection (not the mesh raycast
 * hit) so they are exact even before the mesh matrixWorld updates.
 */
export function PenTool() {
  const drawPlaneY = usePathStore((s) => s.drawPlaneY)
  const drag = useRef<{ id: string; origin: THREE.Vector3 } | null>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  useEditorOnly(meshRef)
  const plane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -drawPlaneY),
    [drawPlaneY],
  )
  const hit = useRef(new THREE.Vector3())

  const intersect = (e: ThreeEvent<PointerEvent>) => e.ray.intersectPlane(plane, hit.current)

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const p = intersect(e)
    if (!p) return
    const id = usePathStore.getState().addAnchor([p.x, p.y, p.z])
    drag.current = { id, origin: p.clone() }
    capturePointer(e)
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    const p = intersect(e)
    if (!p) return
    const out = p.clone().sub(drag.current.origin)
    if (out.length() > 0.05) {
      usePathStore.getState().setHandleOut(drag.current.id, [out.x, out.y, out.z], true)
    }
  }

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    drag.current = null
    releasePointer(e)
  }

  return (
    <mesh
      ref={meshRef}
      rotation-x={-Math.PI / 2}
      position-y={drawPlaneY}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <planeGeometry args={[400, 400]} />
      <meshBasicMaterial color="#3b82f6" transparent opacity={0.05} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
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
