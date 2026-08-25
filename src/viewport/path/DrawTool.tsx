import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import {
  commitDrawPath,
  defaultDrawHeight,
  finalizeDrawStroke,
  shouldHandleDrawInput,
} from '../../lib/drawPath'
import { useEditorOnly } from '../../lib/editorOnly'
import { useEditorStore } from '../../state/useEditorStore'
import { usePathStore } from '../../state/usePathStore'
import type { Vec3 } from '../../state/useSceneStore'
import { rayFromPointer } from './PenTool'

function ignoreRaycast() {
  // Visual construction plane only — the stroke listens on the canvas.
}

function liftStroke(points: Vec3[], y: number): Vec3[] {
  return points.map((p) => [p[0], y, p[2]])
}

/** Skip micro-moves so the stroke stays a polyline, not a point flood. */
const MIN_STROKE_STEP = 0.04

/**
 * Freehand camera path: drag on the XZ construction plane, resample on
 * release. No grid snap — that turned diagonals into a stair-step.
 */
export function DrawTool() {
  const [planeY, setPlaneY] = useState(defaultDrawHeight)
  const [stroke, setStroke] = useState<Vec3[]>([])
  const [hover, setHover] = useState<Vec3 | null>(null)
  const strokeRef = useRef<Vec3[]>([])
  const drawing = useRef(false)
  const capturedPointer = useRef<number | null>(null)
  const planeYRef = useRef(planeY)
  planeYRef.current = planeY

  const meshRef = useRef<THREE.Mesh>(null)
  useEditorOnly(meshRef)

  const gl = useThree((s) => s.gl)
  const editorCam = useThree((s) => s.camera)
  const editorCamRef = useRef(editorCam)
  editorCamRef.current = editorCam
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const plane = useRef(new THREE.Plane())
  const hitPt = useRef(new THREE.Vector3())

  const project = (ray: THREE.Ray): Vec3 | null => {
    const y = planeYRef.current
    plane.current.set(new THREE.Vector3(0, 1, 0), -y)
    if (!ray.intersectPlane(plane.current, hitPt.current)) return null
    return [hitPt.current.x, y, hitPt.current.z]
  }

  useEffect(() => {
    const el = gl.domElement

    const releaseCapture = () => {
      if (capturedPointer.current === null) return
      try {
        el.releasePointerCapture(capturedPointer.current)
      } catch {
        /* already released */
      }
      capturedPointer.current = null
    }

    const cancelStroke = () => {
      drawing.current = false
      strokeRef.current = []
      setStroke([])
      releaseCapture()
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !shouldHandleDrawInput()) return
      const ray = rayFromPointer(e, el, editorCamRef.current, raycaster)
      if (!ray) return
      const point = project(ray)
      if (!point) return
      e.preventDefault()
      drawing.current = true
      strokeRef.current = [point]
      setStroke([point])
      setHover(null)
      try {
        el.setPointerCapture(e.pointerId)
        capturedPointer.current = e.pointerId
      } catch {
        /* already captured */
      }
    }

    const onMove = (e: PointerEvent) => {
      if (!shouldHandleDrawInput()) return
      const ray = rayFromPointer(e, el, editorCamRef.current, raycaster)
      if (!ray) {
        if (!drawing.current) setHover(null)
        return
      }
      const point = project(ray)
      if (!point) return
      if (!drawing.current) {
        setHover(point)
        return
      }
      const last = strokeRef.current[strokeRef.current.length - 1]
      if (
        last &&
        Math.hypot(point[0] - last[0], point[2] - last[2]) < MIN_STROKE_STEP
      ) {
        return
      }
      strokeRef.current = [...strokeRef.current, point]
      setStroke(strokeRef.current)
    }

    const finish = (e: PointerEvent) => {
      if (!drawing.current) return
      if (e.type === 'pointerup' && e.button !== 0) return
      if (capturedPointer.current !== null && e.pointerId !== capturedPointer.current) return
      drawing.current = false
      releaseCapture()
      const result = finalizeDrawStroke(strokeRef.current, useEditorStore.getState().gridSize)
      strokeRef.current = []
      setStroke([])
      if (result) {
        commitDrawPath(result.positions, result.closed)
        // Leave Draw so orbit / zoom work again — staying in the tool
        // kept LMB and the wheel captured and felt like a freeze.
        useEditorStore.getState().setTool('select')
      }
    }

    const onLostCapture = () => {
      capturedPointer.current = null
    }

    const onWheel = (e: WheelEvent) => {
      if (!drawing.current || !shouldHandleDrawInput()) return
      const ray = rayFromPointer(e as unknown as PointerEvent, el, editorCamRef.current, raycaster)
      if (!ray) return
      e.preventDefault()
      const step = useEditorStore.getState().gridSize
      const next = planeYRef.current + (e.deltaY < 0 ? step : -step)
      planeYRef.current = next
      setPlaneY(next)
      usePathStore.getState().setDrawPlaneY(next)
      strokeRef.current = liftStroke(strokeRef.current, next)
      setStroke(strokeRef.current)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (drawing.current) cancelStroke()
      e.preventDefault()
      useEditorStore.getState().setTool('select')
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', finish)
    el.addEventListener('pointercancel', finish)
    el.addEventListener('lostpointercapture', onLostCapture)
    el.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey, true)
    return () => {
      drawing.current = false
      strokeRef.current = []
      releaseCapture()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', finish)
      el.removeEventListener('pointercancel', finish)
      el.removeEventListener('lostpointercapture', onLostCapture)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [gl, raycaster])

  const ghost = drawing.current ? null : hover
  const line = stroke.length > 1 ? stroke : null

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
      {line && (
        <Line points={line} color="#3b82f6" lineWidth={2} depthTest={false} raycast={ignoreRaycast} />
      )}
      {stroke[0] && (
        <mesh position={stroke[0]} renderOrder={20} raycast={ignoreRaycast}>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshBasicMaterial color="#3b82f6" depthTest={false} />
        </mesh>
      )}
      {ghost && (
        <mesh position={ghost} renderOrder={20} raycast={ignoreRaycast}>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshBasicMaterial color="#3b82f6" depthTest={false} transparent opacity={0.85} />
        </mesh>
      )}
    </>
  )
}
