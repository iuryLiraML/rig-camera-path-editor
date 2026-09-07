import { useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { GizmoControls } from '../GizmoControls'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import {
  centroidOf,
  snapshotAnchors,
  snapshotWorldAnchors,
  worldAnchorPivot,
  type WorldAnchorPoseSnapshot,
} from '../../lib/anchorSelection'
import { buildCurve, computeAutoHandles, nearestCurveParameter } from '../../lib/curve'
import { useEditorOnly } from '../../lib/editorOnly'
import {
  currentPathParentTransform,
  worldHitToPathLocal,
  type PathSpaceScene,
} from '../../lib/pathSpaceBind'
import { eventShiftHeld } from '../../lib/pointerNdc'
import { useScreenScale } from '../../lib/screenScale'
import { useShiftHeld } from '../../lib/useShiftHeld'
import { pathGizmoStealsStroke } from '../../lib/penGesture'
import { isPathStrokeTool } from '../../lib/workspaceChrome'
import {
  isPointGizmoActive,
  isTechMode,
  useEditorStore,
  type GizmoMode,
  type Tool,
} from '../../state/useEditorStore'
import { usePathStore, type AnchorRef, type PathAnchor } from '../../state/usePathStore'
import { useRigStore } from '../../state/useRigStore'
import { useSceneStore, type Vec3 } from '../../state/useSceneStore'
import { activateEditPath, applySelectPointerIntent } from '../../state/cameraPathLink'
import { pathLineAppearance, pathOverlay, PATH_FOLLOWED } from '../../lib/pathVisual'
import { selectPointerIntent } from '../../lib/viewportPick'

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

const HANDLE_COLOR = '#9db9f5'

/** Pointer interaction is owned by the shared canvas controller in PenTool. */
function AnchorGizmo({ anchor }: { anchor: PathAnchor }) {
  const selected = usePathStore((s) => s.selectedAnchorIds.includes(anchor.id))
  const ref = useRef<THREE.Mesh>(null)
  useScreenScale(ref, 0.09)
  return (
    <mesh ref={ref} position={anchor.position} userData={{ pickKind: 'path-anchor', pickId: `anchor:${anchor.id}` }} frustumCulled={false}>
      <boxGeometry args={[0.85, 0.85, 0.85]} />
      <meshBasicMaterial color={selected ? '#ffffff' : PATH_FOLLOWED} depthTest={false} />
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
  const selected = usePathStore((s) => s.selectedAnchorId === anchor.id && s.selectedHandle === which)
  const ref = useRef<THREE.Mesh>(null)
  useScreenScale(ref, 0.085)
  const rel = which === 'in' ? anchor.handleIn : anchor.handleOut
  const tip = anchor.position.map((v, i) => v + rel[i]) as Vec3
  if (Math.hypot(...rel) < 1e-8) return null
  return (
    <group>
      <Line points={[anchor.position, tip]} color={HANDLE_COLOR} lineWidth={1} depthTest={false} raycast={ignoreRaycast} />
      <mesh ref={ref} position={tip} userData={{ pickKind: 'path-anchor', pickId: `handle:${anchor.id}:${which}` }} frustumCulled={false}>
        {which === 'in' ? <boxGeometry args={[1, 1, 1]} /> : <sphereGeometry args={[0.6, 12, 12]} />}
        <meshBasicMaterial color={selected ? '#ffffff' : which === 'in' ? '#f0bd77' : HANDLE_COLOR} depthTest={false} />
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

  const active = usePathStore(s => s.getPath(s.activePathId))
  const primary = computeAutoHandles(anchors, active?.closed ?? false, active?.rounding ?? .8).find(anchor => anchor.id === selectedAnchorId) ?? selected[selected.length - 1]

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

function PathStroke({
  points,
  followed,
  selected,
  pathId,
  tool,
  onInsert,
  appearance,
}: {
  points: THREE.Vector3[]
  followed: boolean
  selected: boolean
  pathId: string
  tool: Tool
  onInsert?: (point: THREE.Vector3) => void
  appearance?: ReturnType<typeof pathLineAppearance>
}) {
  const look = appearance ?? pathLineAppearance(followed, selected)
  const pickable = !isPathStrokeTool(tool)
  return (
    <group userData={{ pickKind: 'path-line', pickId: `path:${pathId}` }}>
      {look.halo && (
        <Line
          points={points}
          color={look.haloColor}
          lineWidth={look.lineWidth + 2.5}
          transparent
          opacity={0.45}
          depthTest={false}
          raycast={ignoreRaycast}
        />
      )}
      <Line
        points={points}
        color={look.color}
        lineWidth={look.lineWidth}
        transparent
        opacity={look.opacity}
        depthTest={false}
        {...(pickable
          ? {
              onPointerDown: (e: ThreeEvent<PointerEvent>) => {
                if (e.button !== 0) return
                if (useEditorStore.getState().cameraView) return
                const intent = selectPointerIntent(e.intersections)
                if (intent.action !== 'select-path' || intent.id !== `path:${pathId}`) return
                e.stopPropagation()
                applySelectPointerIntent(intent, eventShiftHeld(e))
              },
              onDoubleClick: (e: ThreeEvent<PointerEvent>) => {
                if (!onInsert) return
                e.stopPropagation()
                onInsert(e.point)
              },
            }
          : {})}
      />
    </group>
  )
}

function InactiveAnchorGizmo({ pathId, anchor }: { pathId: string; anchor: PathAnchor }) {
  const ref = useRef<THREE.Mesh>(null)
  const tool = useEditorStore((s) => s.tool)
  const stealStroke = pathGizmoStealsStroke(tool)
  useScreenScale(ref, 0.055)
  return (
    <mesh
      ref={ref}
      position={anchor.position}
      userData={{ pickKind: 'path-anchor', pickId: `anchor:${anchor.id}` }}
      frustumCulled={false}
      raycast={stealStroke ? undefined : ignoreRaycast}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        if (useEditorStore.getState().cameraView) return
        if (!pathGizmoStealsStroke(useEditorStore.getState().tool)) return
        e.stopPropagation()
        activateEditPath(pathId)
        usePathStore.getState().selectAnchor(anchor.id, eventShiftHeld(e))
      }}
    >
      <boxGeometry args={[0.7, 0.7, 0.7]} />
      <meshBasicMaterial color="#c7c7cc" depthTest={false} />
    </mesh>
  )
}
export function InactivePaths() {
  const paths = usePathStore((s) => s.paths)
  const activePathId = usePathStore((s) => s.activePathId)
  const cameraPathId = useRigStore((s) => s.cameraPathId)
  const playMode = useEditorStore((s) => s.playMode)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const hiddenIds = useEditorStore((s) => s.hiddenIds)
  const selectionIds = useEditorStore((s) => s.selectionIds)
  const tool = useEditorStore((s) => s.tool)
  const selectedAnchorRefs = usePathStore((s) => s.selectedAnchorRefs)
  const tech = useEditorStore((s) => isTechMode(s.viewMode))
  const rootRef = useRef<THREE.Group>(null)
  useEditorOnly(rootRef)

  const pathItems = useMemo(
    () =>
      paths
        .filter((p) => p.id !== activePathId && !hiddenIds.includes(`path:${p.id}`))
        .map((p) => {
          const overlay = pathOverlay({
            playMode,
            workspaceMode,
            hidden: false,
            tech,
            anchorCount: p.anchors.length,
            followed: p.id === cameraPathId,
            selected: selectionIds.includes(`path:${p.id}`),
          })
          const curve = overlay.stroke ? buildCurve(p.anchors, p.closed, p.rounding) : null
          const selectedIds = new Set(
            selectedAnchorRefs
              .filter((ref) => ref.pathId === p.id)
              .map((ref) => ref.anchorId),
          )
          return {
            id: p.id,
            anchors: p.anchors,
            overlay,
            points: curve ? curve.getPoints(Math.max(64, p.anchors.length * 24)) : null,
            selectedAnchors: p.anchors.filter((anchor) => selectedIds.has(anchor.id)),
          }
        }),
    [
      paths,
      activePathId,
      hiddenIds,
      selectedAnchorRefs,
      playMode,
      workspaceMode,
      tech,
      cameraPathId,
      selectionIds,
    ],
  )

  if (tech || pathItems.length === 0) return null

  return (
    <group ref={rootRef} renderOrder={9}>
      {pathItems.map((item) => (
        <ParentSpaceGroup key={item.id} pathId={item.id}>
          {item.overlay.stroke && item.points && (
            <PathStroke
              points={item.points}
              followed={item.id === cameraPathId}
              selected={selectionIds.includes(`path:${item.id}`)}
              pathId={item.id}
              tool={tool}
              appearance={item.overlay.appearance}
            />
          )}
          {item.overlay.editChrome &&
            item.anchors.map((anchor) => (
              <InactiveAnchorGizmo key={anchor.id} pathId={item.id} anchor={anchor} />
            ))}
          {item.selectedAnchors.map((anchor) => (
            <SelectedAnchorMarker key={`sel-${anchor.id}`} anchor={anchor} />
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
  const showAllHandles = usePathStore((s) => s.showAllHandles)
  const selectedAnchorRefs = usePathStore((s) => s.selectedAnchorRefs)
  const primaryAnchorRef = usePathStore((s) => s.primaryAnchorRef)
  const tool = useEditorStore((s) => s.tool)
  const pointContextActive = useEditorStore((s) =>
    isPointGizmoActive(s.selection, primaryAnchorRef),
  )
  const pathSelected = useEditorStore((s) =>
    active ? s.selectionIds.includes(`path:${active.id}`) : false,
  )
  const cameraPathId = useRigStore((s) => s.cameraPathId)
  const playMode = useEditorStore((s) => s.playMode)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
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

  const overlay = pathOverlay({
    playMode,
    workspaceMode,
    hidden: pathHidden,
    tech,
    anchorCount: anchors.length,
    followed: Boolean(active && active.id === cameraPathId),
    selected: pathSelected,
  })
  if (!overlay.stroke && !overlay.editChrome) return null

  const handleAnchors = resolved.filter(a => showAllHandles || ((pointContextActive || tool === 'pen') && selectedAnchorRefs.some(ref => ref.pathId === active!.id && ref.anchorId === a.id)))
  const selectedPathIds = new Set(selectedAnchorRefs.map((ref) => ref.pathId))
  const multiPathSelection = selectedPathIds.size > 1

  // double-click on the curve inserts an anchor into the nearest segment
  const insertAt = (point: THREE.Vector3) => {
    if (!curve) return
    const local = toPathLocal([point.x, point.y, point.z])
    const hit = nearestCurveParameter(curve, new THREE.Vector3(...local))
    usePathStore.getState().splitSegment(hit.index, hit.t)
    useEditorStore.getState().select('camera-path')
  }

  return (
    <>
      <ParentSpaceGroup pathId={active!.id} renderOrder={10}>
        {overlay.stroke && points && (
          <PathStroke
            points={points}
            followed={active!.id === cameraPathId}
            selected={pathSelected}
            pathId={active!.id}
            tool={tool}
            appearance={overlay.appearance}
            onInsert={overlay.editChrome ? insertAt : undefined}
          />
        )}
        {overlay.editChrome &&
          anchors.map((a) => <AnchorGizmo key={a.id} anchor={a} />)}
        {overlay.editChrome && handleAnchors.map(anchor => (
          <group key={`handles:${anchor.id}`}>
            <HandleGizmo anchor={anchor} which="in" />
            <HandleGizmo anchor={anchor} which="out" />
          </group>
        ))}
      </ParentSpaceGroup>
      {overlay.editChrome && pointContextActive && tool === 'select' && selectedAnchorId && (
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
