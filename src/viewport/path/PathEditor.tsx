import { useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { GizmoControls } from '../GizmoControls'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import {
  centroidOf,
  snapshotAnchors,
  snapshotWorldAnchors,
  worldAnchorPivot,
  type WorldAnchorPoseSnapshot,
} from '../../lib/anchorSelection'
import { buildCurve, computeAutoHandles } from '../../lib/curve'
import { useEditorOnly } from '../../lib/editorOnly'
import { lockOrbit, unlockOrbit } from '../../lib/orbitLock'
import { localPointToWorld } from '../../lib/pathSpace'
import {
  currentPathParentTransform,
  worldHitToPathLocal,
  type PathSpaceScene,
} from '../../lib/pathSpaceBind'
import { useScreenScale } from '../../lib/screenScale'
import { useShiftHeld } from '../../lib/useShiftHeld'
import { isPathEditing, isPathStrokeTool, pathGuidesVisible } from '../../lib/workspaceChrome'
import {
  isPointGizmoActive,
  useEditorStore,
  type GizmoMode,
} from '../../state/useEditorStore'
import { usePathStore, type AnchorRef, type PathAnchor } from '../../state/usePathStore'
import { useRigStore } from '../../state/useRigStore'
import { useSceneStore, type Vec3 } from '../../state/useSceneStore'
import { isTechMode } from '../RenderPasses'
import { capturePointer, finishPen, releasePointer } from './PenTool'

function ignoreRaycast() {
  // Decorative path strokes must not steal object clicks.
}

const DEG = Math.PI / 180

function pathScene(): PathSpaceScene {
  return { objects: useSceneStore.getState().objects, paths: usePathStore.getState().paths }
}

function toPathLocal(world: Vec3): Vec3 {
  return worldHitToPathLocal(world, usePathStore.getState().activePathId, pathScene())
}

function applyParentToGroup(group: THREE.Group | null, pathId: string) {
  if (!group) return
  const parent = currentPathParentTransform(pathId, pathScene())
  if (!parent) {
    group.position.set(0, 0, 0)
    group.rotation.set(0, 0, 0)
    group.scale.set(1, 1, 1)
    return
  }
  group.position.set(...parent.position)
  group.rotation.set(parent.rotation[0] * DEG, parent.rotation[1] * DEG, parent.rotation[2] * DEG)
  group.scale.set(...parent.scale)
}

function ParentSpaceGroup({
  pathId,
  renderOrder,
  children,
}: {
  pathId: string
  renderOrder?: number
  children: ReactNode
}) {
  const ref = useRef<THREE.Group>(null)
  useEditorOnly(ref)
  useFrame(() => applyParentToGroup(ref.current, pathId))
  return (
    <group ref={ref} renderOrder={renderOrder}>
      {children}
    </group>
  )
}

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
      lockOrbit()
      if (controls) controls.enabled = false
      capturePointer(e)
    },
    move: (e: ThreeEvent<PointerEvent>): THREE.Vector3 | null =>
      e.ray.intersectPlane(plane.current, hit.current),
    end: (e: ThreeEvent<PointerEvent>) => {
      unlockOrbit()
      releasePointer(e)
    },
  }
}

function AnchorGizmo({ anchor, isFirst }: { anchor: PathAnchor; isFirst: boolean }) {
  const tool = useEditorStore((s) => s.tool)
  const selected = usePathStore((s) => s.selectedAnchorIds.includes(anchor.id))
  const ref = useRef<THREE.Mesh>(null)
  useScreenScale(ref, 0.07)

  return (
    <mesh
      ref={ref}
      position={anchor.position}
      userData={{ pickKind: 'path-anchor', pickId: `anchor:${anchor.id}` }}
      frustumCulled={false}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        if (useEditorStore.getState().cameraView) return
        // while drawing, clicking the first anchor closes the loop
        if (isPathStrokeTool(tool)) {
          if (tool === 'pen' && isFirst) {
            e.stopPropagation()
            finishPen(true)
          }
          return
        }
        useEditorStore.getState().select('camera-path')
        useEditorStore.getState().setTool('select')
        const additive = Boolean(e.shiftKey || e.nativeEvent.shiftKey)
        usePathStore.getState().selectAnchor(anchor.id, additive)
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
      }}
    >
      <boxGeometry args={[0.85, 0.85, 0.85]} />
      <meshBasicMaterial color={selected ? '#ffffff' : ACCENT} depthTest={false} />
    </mesh>
  )
}

function SelectedAnchorMarker({ anchor }: { anchor: PathAnchor }) {
  const ref = useRef<THREE.Mesh>(null)
  useScreenScale(ref, 0.07)
  return (
    <mesh ref={ref} position={anchor.position} frustumCulled={false} raycast={ignoreRaycast}>
      <boxGeometry args={[0.85, 0.85, 0.85]} />
      <meshBasicMaterial color="#ffffff" depthTest={false} />
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
      <Line
        points={[anchor.position, tip]}
        color={HANDLE_COLOR}
        lineWidth={1}
        depthTest={false}
        raycast={ignoreRaycast}
      />
      <mesh
        ref={ref}
        position={tip}
        userData={{ pickKind: 'path-anchor', pickId: `handle:${anchor.id}:${which}` }}
        frustumCulled={false}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if (useEditorStore.getState().cameraView) return
          usePathStore.getState().selectAnchor(anchor.id)
          usePathStore.getState().selectHandle(which)
          dragging.current = true
          const parent = currentPathParentTransform(usePathStore.getState().activePathId, pathScene())
          const worldTip = parent ? localPointToWorld(tip, parent) : tip
          drag.start(e, worldTip[1])
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return
          const p = drag.move(e)
          if (p) {
            const local = toPathLocal([p.x, p.y, p.z])
            usePathStore
              .getState()
              .setHandle(
                anchor.id,
                which,
                [local[0] - anchor.position[0], local[1] - anchor.position[1], local[2] - anchor.position[2]],
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

function pathGizmoMode(selectedHandle: 'none' | 'in' | 'out', gizmoMode: GizmoMode): GizmoMode {
  switch (selectedHandle) {
    case 'in':
    case 'out':
      return 'translate'
    case 'none':
      return gizmoMode
    default: {
      const _never: never = selectedHandle
      return _never
    }
  }
}

function activeAnchors() {
  const path = usePathStore.getState()
  return path.paths.find((item) => item.id === path.activePathId)?.anchors ?? []
}

function worldSelectionSnapshot(
  refs: readonly AnchorRef[],
): WorldAnchorPoseSnapshot[] {
  const scene = pathScene()
  return snapshotWorldAnchors(
    scene.paths.map((path) => ({
      pathId: path.id,
      anchors: path.anchors,
      parent: currentPathParentTransform(path.id, scene),
    })),
    refs,
  )
}

/**
 * Same W/E/R TransformControls as scene objects. Sits on the selection
 * centroid (or a handle tip) and writes a snapshot-based group transform
 * so React's re-render cannot fight the gizmo mid-drag.
 */
function PathTransformGizmo({ worldSpace }: { worldSpace: boolean }) {
  const gizmoMode = useEditorStore((s) => s.gizmoMode)
  const selectedHandle = usePathStore((s) => s.selectedHandle)
  const selectedAnchorIds = usePathStore((s) => s.selectedAnchorIds)
  const selectedAnchorId = usePathStore((s) => s.selectedAnchorId)
  const selectedAnchorRefs = usePathStore((s) => s.selectedAnchorRefs)
  const anchors = usePathStore((s) => s.paths.find((p) => p.id === s.activePathId)?.anchors ?? [])
  useRigStore((s) => s.t)
  const shiftHeld = useShiftHeld()
  const snapEnabled = useEditorStore((s) => s.snapEnabled)
  const gridSize = useEditorStore((s) => s.gridSize)
  const proxyRef = useRef<THREE.Group>(null)
  const dragging = useRef(false)
  const groupDrag = useRef<
    | { mode: 'local'; snapshot: ReturnType<typeof snapshotAnchors>; startPivot: Vec3 }
    | { mode: 'world'; snapshot: WorldAnchorPoseSnapshot[]; startPivot: Vec3 }
    | null
  >(null)
  const selected = useMemo(() => {
    const wanted = new Set(selectedAnchorIds)
    return anchors.filter((anchor) => wanted.has(anchor.id))
  }, [anchors, selectedAnchorIds])

  const primary = anchors.find((anchor) => anchor.id === selectedAnchorId) ?? selected[selected.length - 1]

  const target: Vec3 = (() => {
    if (primary && selectedHandle === 'in') {
      return [
        primary.position[0] + primary.handleIn[0],
        primary.position[1] + primary.handleIn[1],
        primary.position[2] + primary.handleIn[2],
      ]
    }
    if (primary && selectedHandle === 'out') {
      return [
        primary.position[0] + primary.handleOut[0],
        primary.position[1] + primary.handleOut[1],
        primary.position[2] + primary.handleOut[2],
      ]
    }
    if (worldSpace) return worldAnchorPivot(worldSelectionSnapshot(selectedAnchorRefs))
    return centroidOf(selected.map((anchor) => anchor.position))
  })()

  const mode = pathGizmoMode(selectedHandle, gizmoMode)

  // Imperative pose only — a React `position={target}` prop overwrites the
  // TransformControls drag on every store write.
  useLayoutEffect(() => {
    if (dragging.current) return
    const proxy = proxyRef.current
    if (!proxy) return
    proxy.position.set(target[0], target[1], target[2])
    proxy.quaternion.identity()
    proxy.scale.set(1, 1, 1)
  }, [target[0], target[1], target[2], selectedHandle, selectedAnchorIds.join('|'), selectedAnchorRefs, worldSpace])

  const beginGroupDrag = () => {
    if (groupDrag.current) return
    const path = usePathStore.getState()
    if (path.selectedHandle !== 'none') return
    if (worldSpace) {
      const snapshot = worldSelectionSnapshot(path.selectedAnchorRefs)
      if (snapshot.length === 0) return
      groupDrag.current = {
        mode: 'world',
        snapshot,
        startPivot: worldAnchorPivot(snapshot),
      }
      return
    }
    const snapshot = snapshotAnchors(activeAnchors(), path.selectedAnchorIds)
    if (snapshot.length === 0) return
    groupDrag.current = {
      mode: 'local',
      snapshot,
      startPivot: centroidOf(snapshot.map((item) => item.position)),
    }
  }

  const resetProxyIdle = () => {
    const proxy = proxyRef.current
    if (!proxy) return
    const path = usePathStore.getState()
    const selectedIds = new Set(path.selectedAnchorIds)
    const pivot = worldSpace
      ? worldAnchorPivot(worldSelectionSnapshot(path.selectedAnchorRefs))
      : centroidOf(
          activeAnchors()
            .filter((anchor) => selectedIds.has(anchor.id))
            .map((anchor) => anchor.position),
        )
    proxy.position.set(pivot[0], pivot[1], pivot[2])
    proxy.quaternion.identity()
    proxy.scale.set(1, 1, 1)
  }

  return (
    <>
      <group ref={proxyRef} />
      {!shiftHeld && selectedAnchorIds.length > 0 && (
        <GizmoControls
          object={proxyRef as RefObject<THREE.Group>}
          mode={mode}
          size={0.65}
          translationSnap={snapEnabled ? gridSize : undefined}
          onMouseDown={() => {
            dragging.current = true
            beginGroupDrag()
          }}
          onMouseUp={() => {
            dragging.current = false
            groupDrag.current = null
            if (usePathStore.getState().selectedHandle === 'none') resetProxyIdle()
          }}
          onObjectChange={() => {
            dragging.current = true
            const proxy = proxyRef.current
            if (!proxy) return
            const path = usePathStore.getState()
            if (path.selectedHandle !== 'none') {
              const id = path.selectedAnchorId
              if (!id) return
              const anchor = activeAnchors().find((item) => item.id === id)
              if (!anchor) return
              path.setHandle(
                id,
                path.selectedHandle,
                [
                  proxy.position.x - anchor.position[0],
                  proxy.position.y - anchor.position[1],
                  proxy.position.z - anchor.position[2],
                ],
                false,
              )
              return
            }
            beginGroupDrag()
            const drag = groupDrag.current
            if (!drag) return
            const transform = {
              startPivot: drag.startPivot,
              currentPivot: [proxy.position.x, proxy.position.y, proxy.position.z] as Vec3,
              quat: [proxy.quaternion.x, proxy.quaternion.y, proxy.quaternion.z, proxy.quaternion.w] as const,
              scale: [proxy.scale.x, proxy.scale.y, proxy.scale.z] as Vec3,
            }
            if (drag.mode === 'world') {
              path.applyWorldAnchorGroupTransform({ snapshot: drag.snapshot, ...transform })
            } else {
              path.applyAnchorGroupTransform({ snapshot: drag.snapshot, ...transform })
            }
          }}
        />
      )}
    </>
  )
}

/** Faint, non-interactive lines for every path that is not being edited. */
export function InactivePaths() {
  const paths = usePathStore((s) => s.paths)
  const activePathId = usePathStore((s) => s.activePathId)
  const playMode = useEditorStore((s) => s.playMode)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const cameraKind = useRigStore((s) => s.cameraKind)
  const hiddenIds = useEditorStore((s) => s.hiddenIds)
  const selectionIds = useEditorStore((s) => s.selectionIds)
  const selectedAnchorRefs = usePathStore((s) => s.selectedAnchorRefs)
  const tech = useEditorStore((s) => isTechMode(s.viewMode))
  const rootRef = useRef<THREE.Group>(null)
  useEditorOnly(rootRef)

  const pathItems = useMemo(
    () =>
      paths
        .filter((p) => p.id !== activePathId && !hiddenIds.includes(`path:${p.id}`))
        .map((p) => {
          const curve = p.anchors.length >= 2 ? buildCurve(p.anchors, p.closed, p.rounding) : null
          const selectedIds = new Set(
            selectedAnchorRefs
              .filter((ref) => ref.pathId === p.id)
              .map((ref) => ref.anchorId),
          )
          return {
            id: p.id,
            points: curve ? curve.getPoints(Math.max(64, p.anchors.length * 24)) : null,
            selectedAnchors: p.anchors.filter((anchor) => selectedIds.has(anchor.id)),
          }
        }),
    [paths, activePathId, hiddenIds, selectedAnchorRefs],
  )

  if (!pathGuidesVisible(playMode, workspaceMode, cameraKind) || tech || pathItems.length === 0) return null

  return (
    <group ref={rootRef} renderOrder={9}>
      {pathItems.map((item) => (
        <ParentSpaceGroup key={item.id} pathId={item.id}>
          {item.points && (
            <Line
              points={item.points}
              color={selectionIds.includes(`path:${item.id}`) ? '#ffffff' : ACCENT}
              lineWidth={selectionIds.includes(`path:${item.id}`) ? 2.5 : 1.5}
              transparent
              opacity={selectionIds.includes(`path:${item.id}`) ? 0.9 : 0.35}
              depthTest={false}
              raycast={ignoreRaycast}
            />
          )}
          {item.selectedAnchors.map((anchor) => (
            <SelectedAnchorMarker key={anchor.id} anchor={anchor} />
          ))}
        </ParentSpaceGroup>
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
  const selectedAnchorRefs = usePathStore((s) => s.selectedAnchorRefs)
  const primaryAnchorRef = usePathStore((s) => s.primaryAnchorRef)
  const tool = useEditorStore((s) => s.tool)
  const pointContextActive = useEditorStore((s) =>
    isPointGizmoActive(s.selection, primaryAnchorRef),
  )
  const pathSelected = useEditorStore((s) =>
    active ? s.selectionIds.includes(`path:${active.id}`) : false,
  )
  const playMode = useEditorStore((s) => s.playMode)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const cameraKind = useRigStore((s) => s.cameraKind)
  const pathHidden = useEditorStore((s) =>
    active ? s.hiddenIds.includes(`path:${active.id}`) : false,
  )
  const tech = useEditorStore((s) => isTechMode(s.viewMode))

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

  if (
    !isPathEditing(playMode, workspaceMode) ||
    cameraKind === 'static' ||
    pathHidden ||
    tech ||
    anchors.length === 0
  )
    return null

  const selected = resolved.find((a) => a.id === selectedAnchorId)
  const selectedPathIds = new Set(selectedAnchorRefs.map((ref) => ref.pathId))
  const multiPathSelection = selectedPathIds.size > 1

  // double-click on the curve inserts an anchor into the nearest segment
  const insertAt = (point: THREE.Vector3) => {
    if (!curve) return
    const local = toPathLocal([point.x, point.y, point.z])
    const localPoint = new THREE.Vector3(...local)
    const segments = curve.curves
    let best = 0
    let bestDist = Infinity
    segments.forEach((segment, i) => {
      for (let s = 0; s <= 24; s++) {
        const d = segment.getPoint(s / 24).distanceToSquared(localPoint)
        if (d < bestDist) {
          bestDist = d
          best = i
        }
      }
    })
    usePathStore.getState().insertAnchor(best + 1, local)
    useEditorStore.getState().select('camera-path')
  }

  return (
    <>
      <ParentSpaceGroup pathId={active!.id} renderOrder={10}>
        {points && (
          <group userData={{ pickKind: 'path-line', pickId: `path:${active!.id}` }}>
            <Line
              points={points}
              color={pathSelected ? '#ffffff' : ACCENT}
              lineWidth={pathSelected ? 2.75 : 2}
              depthTest={false}
              {...(isPathStrokeTool(tool) ? { raycast: ignoreRaycast } : {})}
              onDoubleClick={(e) => {
                if (isPathStrokeTool(tool)) return
                e.stopPropagation()
                insertAt(e.point)
              }}
            />
          </group>
        )}
        {anchors.map((a, i) => (
          <AnchorGizmo key={a.id} anchor={a} isFirst={i === 0} />
        ))}
        {pointContextActive && selected && (
          <>
            <HandleGizmo anchor={selected} which="in" />
            <HandleGizmo anchor={selected} which="out" />
          </>
        )}
      </ParentSpaceGroup>
      {pointContextActive && !isPathStrokeTool(tool) && selectedAnchorId && (
        multiPathSelection ? (
          <PathTransformGizmo worldSpace />
        ) : (
          <ParentSpaceGroup pathId={active!.id} renderOrder={11}>
            <PathTransformGizmo worldSpace={false} />
          </ParentSpaceGroup>
        )
      )}
    </>
  )
}
