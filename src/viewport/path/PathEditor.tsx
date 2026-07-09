import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Line, TransformControls } from '@react-three/drei'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useEditorStore } from '../../state/useEditorStore'
import { usePathStore, type PathAnchor } from '../../state/usePathStore'
import type { Vec3 } from '../../state/useSceneStore'
import { buildCurve, computeAutoHandles } from '../../lib/curve'
import { useEditorOnly } from '../../lib/editorOnly'
import { isTechMode } from '../RenderPasses'
import { useScreenScale } from '../../lib/screenScale'
import { capturePointer, finishPen, releasePointer } from './PenTool'

const ACCENT = '#3b82f6'
const HANDLE_COLOR = '#9db9f5'

/** Drag helper: intersect the pointer ray with a horizontal plane at `y`. */
function useHorizontalDrag() {
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const plane = useRef(new THREE.Plane())
  const hit = useRef(new THREE.Vector3())

  return {
    start: (e: ThreeEvent<PointerEvent>, y: number) => {
      e.stopPropagation()
      plane.current.set(new THREE.Vector3(0, 1, 0), -y)
      if (controls) controls.enabled = false
      capturePointer(e)
    },
    move: (e: ThreeEvent<PointerEvent>): THREE.Vector3 | null =>
      e.ray.intersectPlane(plane.current, hit.current),
    end: (e: ThreeEvent<PointerEvent>) => {
      if (controls) controls.enabled = true
      releasePointer(e)
    },
  }
}

function AnchorGizmo({ anchor, isFirst }: { anchor: PathAnchor; isFirst: boolean }) {
  const tool = useEditorStore((s) => s.tool)
  const selected = usePathStore((s) => s.selectedAnchorId === anchor.id && s.selectedHandle === 'none')
  const drag = useHorizontalDrag()
  const dragging = useRef(false)
  const ref = useRef<THREE.Mesh>(null)
  useScreenScale(ref, 0.1)

  return (
    <mesh
      ref={ref}
      position={anchor.position}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        // while drawing, clicking the first anchor closes the loop
        if (tool === 'pen') {
          if (isFirst) {
            e.stopPropagation()
            finishPen(true)
          }
          return
        }
        useEditorStore.getState().select('camera-path')
        usePathStore.getState().selectAnchor(anchor.id) // resets handle sub-selection
        dragging.current = true
        drag.start(e, anchor.position[1])
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const p = drag.move(e)
        if (p) {
          usePathStore.getState().updateAnchorPosition(anchor.id, [p.x, anchor.position[1], p.z])
        }
      }}
      onPointerUp={(e) => {
        dragging.current = false
        drag.end(e)
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={selected ? '#ffffff' : ACCENT} depthTest={false} />
    </mesh>
  )
}

function HandleGizmo({ anchor, which }: { anchor: PathAnchor; which: 'in' | 'out' }) {
  const selected = usePathStore((s) => s.selectedHandle === which)
  const drag = useHorizontalDrag()
  const dragging = useRef(false)
  const ref = useRef<THREE.Mesh>(null)
  useScreenScale(ref, 0.06)
  const rel = which === 'in' ? anchor.handleIn : anchor.handleOut
  const tip: Vec3 = [
    anchor.position[0] + rel[0],
    anchor.position[1] + rel[1],
    anchor.position[2] + rel[2],
  ]

  return (
    <group>
      <Line points={[anchor.position, tip]} color={HANDLE_COLOR} lineWidth={1} depthTest={false} />
      <mesh
        ref={ref}
        position={tip}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          usePathStore.getState().selectAnchor(anchor.id)
          usePathStore.getState().selectHandle(which)
          dragging.current = true
          drag.start(e, tip[1])
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return
          const p = drag.move(e)
          if (p) {
            usePathStore
              .getState()
              .setHandle(
                anchor.id,
                which,
                [p.x - anchor.position[0], tip[1] - anchor.position[1], p.z - anchor.position[2]],
                e.altKey,
              )
          }
        }}
        onPointerUp={(e) => {
          dragging.current = false
          drag.end(e)
        }}
      >
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color={selected ? '#ffffff' : HANDLE_COLOR} depthTest={false} />
      </mesh>
    </group>
  )
}

/**
 * TransformControls (translate) on the currently selected anchor or handle.
 * Attaches to an imperative proxy — not the visible mesh (which has a
 * controlled position + screen-scale) — and writes moves back to the store.
 */
function PathTransformGizmo({ anchor }: { anchor: PathAnchor }) {
  const selectedHandle = usePathStore((s) => s.selectedHandle)
  const proxyRef = useRef<THREE.Object3D>(null)
  const controlRef = useRef<THREE.Object3D>(null)
  const dragging = useRef(false)
  useEditorOnly(controlRef)

  // target world position: the anchor, or a handle tip
  const target: Vec3 =
    selectedHandle === 'in'
      ? [
          anchor.position[0] + anchor.handleIn[0],
          anchor.position[1] + anchor.handleIn[1],
          anchor.position[2] + anchor.handleIn[2],
        ]
      : selectedHandle === 'out'
        ? [
            anchor.position[0] + anchor.handleOut[0],
            anchor.position[1] + anchor.handleOut[1],
            anchor.position[2] + anchor.handleOut[2],
          ]
        : anchor.position

  // keep the proxy synced to the store target, except while dragging it
  useEffect(() => {
    if (!dragging.current) proxyRef.current?.position.set(target[0], target[1], target[2])
  }, [target])

  const onObjectChange = () => {
    const p = proxyRef.current
    if (!p) return
    const path = usePathStore.getState()
    if (selectedHandle === 'none') {
      path.updateAnchorPosition(anchor.id, [p.position.x, p.position.y, p.position.z])
    } else {
      path.setHandle(
        anchor.id,
        selectedHandle,
        [p.position.x - anchor.position[0], p.position.y - anchor.position[1], p.position.z - anchor.position[2]],
        false,
      )
    }
  }

  return (
    <>
      <object3D ref={proxyRef} position={target} />
      <TransformControls
        ref={controlRef as never}
        object={proxyRef as React.RefObject<THREE.Object3D>}
        mode="translate"
        size={0.7}
        onObjectChange={onObjectChange}
        onMouseDown={() => (dragging.current = true)}
        onMouseUp={() => (dragging.current = false)}
      />
    </>
  )
}

/** Faint, non-interactive lines for every path that is not being edited. */
export function InactivePaths() {
  const paths = usePathStore((s) => s.paths)
  const activePathId = usePathStore((s) => s.activePathId)
  const playMode = useEditorStore((s) => s.playMode)
  const tech = useEditorStore((s) => isTechMode(s.viewMode))
  const rootRef = useRef<THREE.Group>(null)
  useEditorOnly(rootRef)

  const lines = useMemo(
    () =>
      paths
        .filter((p) => p.id !== activePathId && p.anchors.length >= 2)
        .map((p) => {
          const curve = buildCurve(p.anchors, p.closed, p.rounding)
          return curve ? { id: p.id, points: curve.getPoints(Math.max(64, p.anchors.length * 24)) } : null
        })
        .filter((x): x is { id: string; points: THREE.Vector3[] } => x !== null),
    [paths, activePathId],
  )

  if (playMode || tech || lines.length === 0) return null

  return (
    <group ref={rootRef} renderOrder={9}>
      {lines.map((l) => (
        <Line key={l.id} points={l.points} color={ACCENT} lineWidth={1.5} transparent opacity={0.35} depthTest={false} />
      ))}
    </group>
  )
}

export function PathEditor() {
  const active = usePathStore((s) => s.paths.find((p) => p.id === s.activePathId))
  const anchors = active?.anchors ?? []
  const closed = active?.closed ?? false
  const rounding = active?.rounding ?? 0.8
  const selectedAnchorId = usePathStore((s) => s.selectedAnchorId)
  const tool = useEditorStore((s) => s.tool)
  const playMode = useEditorStore((s) => s.playMode)
  const tech = useEditorStore((s) => isTechMode(s.viewMode))

  const rootRef = useRef<THREE.Group>(null)
  useEditorOnly(rootRef)

  const curve = useMemo(() => buildCurve(anchors, closed, rounding), [anchors, closed, rounding])
  const points = useMemo(
    () => (curve ? curve.getPoints(Math.max(96, anchors.length * 32)) : null),
    [curve, anchors.length],
  )
  // resolved handles so the gizmos show what the curve actually uses
  const resolved = useMemo(
    () => computeAutoHandles(anchors, closed, rounding),
    [anchors, closed, rounding],
  )

  if (playMode || tech || anchors.length === 0) return null

  const selected = resolved.find((a) => a.id === selectedAnchorId)

  // double-click on the curve inserts an anchor into the nearest segment
  const insertAt = (point: THREE.Vector3) => {
    if (!curve) return
    const segments = curve.curves
    let best = 0
    let bestDist = Infinity
    segments.forEach((segment, i) => {
      for (let s = 0; s <= 24; s++) {
        const d = segment.getPoint(s / 24).distanceToSquared(point)
        if (d < bestDist) {
          bestDist = d
          best = i
        }
      }
    })
    usePathStore.getState().insertAnchor(best + 1, [point.x, point.y, point.z])
    useEditorStore.getState().select('camera-path')
  }

  return (
    <group ref={rootRef} renderOrder={10}>
      {points && (
        <Line
          points={points}
          color={ACCENT}
          lineWidth={2}
          depthTest={false}
          onDoubleClick={(e) => {
            e.stopPropagation()
            insertAt(e.point)
          }}
        />
      )}
      {anchors.map((a, i) => (
        <AnchorGizmo key={a.id} anchor={a} isFirst={i === 0} />
      ))}
      {selected && (
        <>
          <HandleGizmo anchor={selected} which="in" />
          <HandleGizmo anchor={selected} which="out" />
          {tool !== 'pen' && <PathTransformGizmo anchor={selected} />}
        </>
      )}
    </group>
  )
}
