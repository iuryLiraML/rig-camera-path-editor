import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { TransformControls, useCursor } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { aimObject } from '../lib/cameraOrientation'
import { buildCurve, clamp01 } from '../lib/curve'
import { useEditorOnly } from '../lib/editorOnly'
import { evalModelTransform } from '../lib/keyframes'
import {
  applyObjectDrag,
  hitOnPlane,
  objectDragMode,
  objectDragPlane,
  snapObjectDrag,
  subtract3,
  type ObjectDragMode,
} from '../lib/planeDrag'
import { repairImportedShading } from '../lib/prepareImport'
import { usePathStore } from '../state/usePathStore'
import { isSceneEditing } from '../lib/workspaceChrome'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore, type SceneObject, type Vec3 } from '../state/useSceneStore'
import { isTechMode } from './RenderPasses'
import { capturePointer, releasePointer } from './path/PenTool'

const DEG = Math.PI / 180
const RAD = 180 / Math.PI
const MESH_DRAG_PX = 3

/** reusable temporaries for the follow-path frame math (avoid per-frame allocs) */

/** live wrapper groups per object id, for framing (F) and preset bounding boxes */
export const objectGroups = new Map<string, THREE.Group>()

/** union bounding box of every object in the scene (world space) */
export function sceneBounds(): THREE.Box3 | null {
  const box = new THREE.Box3()
  let any = false
  objectGroups.forEach((group) => {
    group.updateWorldMatrix(true, true)
    box.expandByObject(group)
    any = true
  })
  return any ? box : null
}

function ObjectGizmo({
  groupRef,
  onChange,
}: {
  groupRef: React.RefObject<THREE.Group | null>
  onChange: () => void
}) {
  const gizmoMode = useEditorStore((s) => s.gizmoMode)
  const snapEnabled = useEditorStore((s) => s.snapEnabled)
  const gridSize = useEditorStore((s) => s.gridSize)
  const ref = useRef<THREE.Object3D>(null)
  useEditorOnly(ref)
  return (
    <TransformControls
      ref={ref as never}
      object={groupRef as React.RefObject<THREE.Group>}
      mode={gizmoMode}
      size={0.65}
      translationSnap={snapEnabled ? gridSize : undefined}
      onObjectChange={onChange}
    />
  )
}

function ObjectNode({ object }: { object: SceneObject }) {
  const selected = useEditorStore((s) => s.selection === `obj:${object.id}`)
  const tool = useEditorStore((s) => s.tool)
  const playMode = useEditorStore((s) => s.playMode)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const locked = useEditorStore((s) => s.lockedIds.includes(object.id))
  const editing = isSceneEditing(playMode, workspaceMode)
  const tech = useEditorStore((s) => isTechMode(s.viewMode))
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef<THREE.Group>(null)
  const mixer = useMemo(() => new THREE.AnimationMixer(object.root), [object.root])

  // path this object rides (if attached); curve rebuilds when that path changes
  const follow = object.follow
  const followPath = usePathStore((s) =>
    follow ? s.paths.find((p) => p.id === follow.pathId) : undefined,
  )
  const followCurve = useMemo(
    () => (followPath ? buildCurve(followPath.anchors, followPath.closed, followPath.rounding) : null),
    [followPath],
  )

  useCursor(hovered && tool === 'select' && editing && !locked)

  useEffect(() => {
    repairImportedShading(object.root)
    object.material.side = THREE.DoubleSide
    object.material.needsUpdate = true
  }, [object.root, object.material])

  // hover/selection feedback: a subtle grayscale lift, no color involved
  useEffect(() => {
    object.material.emissive.setScalar(!editing ? 0 : selected ? 0.1 : hovered ? 0.05 : 0)
  }, [object.material, selected, hovered, editing])

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    objectGroups.set(object.id, group)
    return () => {
      objectGroups.delete(object.id)
    }
  }, [object.id])

  useEffect(() => {
    object.clips.forEach((clip) => mixer.clipAction(clip).play())
    return () => {
      mixer.stopAllAction()
    }
  }, [mixer, object.clips])

  // store -> group (panel/undo edits); the gizmo mutates the group directly
  useEffect(() => {
    const g = groupRef.current
    if (!g) return
    const t = object.transform
    g.position.set(...t.position)
    g.rotation.set(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG)
    g.scale.set(...t.scale)
  }, [object.transform])

  useFrame(() => {
    const rig = useRigStore.getState()
    const seconds = rig.t * rig.duration

    if (object.playClips && object.clips.length > 0) {
      const clipDuration = Math.max(...object.clips.map((c) => c.duration), 0.001)
      mixer.setTime(seconds % clipDuration)
    }

    // follow-path drives the transform and takes priority over pose keyframes
    if (follow && followCurve) {
      const g = groupRef.current
      if (!g) return
      const loops = Math.max(0.01, follow.loops)
      let phase = rig.t * loops + follow.offset
      phase = followPath?.closed ? ((phase % 1) + 1) % 1 : clamp01(phase)
      const p = followCurve.getPointAt(phase)
      g.position.set(p.x, p.y + follow.height, p.z)
      g.scale.set(...object.transform.scale)
      if (follow.align) {
        // same degeneracy as the camera: a path that turns vertical made
        // lookAt's basis collapse and the object flipped in one frame
        const tan = followCurve.getTangentAt(phase)
        aimObject(g, tan, null, follow.bank, 'object')
      } else {
        const r = object.transform.rotation
        g.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG)
      }
      return
    }

    if (object.keys.length === 0) return
    // posing mode: the user is editing this object with the gizmo/panel
    if (selected && !rig.playing) return

    const pose = evalModelTransform(rig.t, object.keys, rig.ease, object.transform)
    const g = groupRef.current
    if (!pose || !g) return
    g.position.set(...pose.position)
    g.rotation.set(pose.rotation[0] * DEG, pose.rotation[1] * DEG, pose.rotation[2] * DEG)
    g.scale.set(...pose.scale)
  })

  const syncTransform = () => {
    const g = groupRef.current
    if (!g) return
    useSceneStore.getState().setTransformAll(object.id, {
      position: g.position.toArray() as Vec3,
      rotation: [g.rotation.x * RAD, g.rotation.y * RAD, g.rotation.z * RAD],
      scale: g.scale.toArray() as Vec3,
    })
  }

  const meshDrag = useRef<{
    mode: ObjectDragMode
    keep: Vec3
    planePoint: Vec3
    planeNormal: Vec3
    grab: Vec3
    startClient: [number, number]
    moved: boolean
  } | null>(null)

  const cameraDirOf = (e: ThreeEvent<PointerEvent>): Vec3 => {
    const n = new THREE.Vector3()
    e.camera.getWorldDirection(n)
    return [n.x, n.y, n.z]
  }

  const rayOf = (e: ThreeEvent<PointerEvent>) => ({
    origin: e.ray.origin.toArray() as Vec3,
    dir: e.ray.direction.toArray() as Vec3,
  })

  const beginMeshDrag = (e: ThreeEvent<PointerEvent>, pos: Vec3, mode: ObjectDragMode) => {
    const plane = objectDragPlane(pos, cameraDirOf(e), mode)
    const { origin, dir } = rayOf(e)
    const hit = hitOnPlane(origin, dir, plane.point, plane.normal)
    if (!hit) return false
    meshDrag.current = {
      mode,
      keep: pos,
      planePoint: plane.point,
      planeNormal: plane.normal,
      grab: subtract3(pos, hit),
      startClient: [e.clientX, e.clientY],
      moved: false,
    }
    return true
  }

  const applyMeshDrag = (e: ThreeEvent<PointerEvent>) => {
    const drag = meshDrag.current
    const g = groupRef.current
    if (!drag || !g) return
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startClient[0], e.clientY - drag.startClient[1]) < MESH_DRAG_PX) {
        return
      }
      drag.moved = true
    }
    const mode = objectDragMode(e.shiftKey)
    const pos: Vec3 = [g.position.x, g.position.y, g.position.z]
    if (mode !== drag.mode) {
      if (!beginMeshDrag(e, pos, mode)) return
      meshDrag.current!.moved = true
    }
    const live = meshDrag.current
    if (!live) return
    const { origin, dir } = rayOf(e)
    const hit = hitOnPlane(origin, dir, live.planePoint, live.planeNormal)
    if (!hit) return
    let next = applyObjectDrag(hit, live.grab, live.keep, live.mode)
    const editor = useEditorStore.getState()
    if (editor.snapEnabled) next = snapObjectDrag(next, editor.gridSize, live.mode)
    g.position.set(...next)
    syncTransform()
  }

  return (
    <>
      <group
        ref={groupRef}
        userData={{ pickKind: 'object', pickId: `obj:${object.id}` }}
        onPointerDown={(e) => {
          const editor = useEditorStore.getState()
          if (editor.tool !== 'select' || !isSceneEditing(editor.playMode, editor.workspaceMode) || e.button !== 0) return
          if (useEditorStore.getState().lockedIds.includes(object.id)) {
            e.stopPropagation()
            editor.select(`obj:${object.id}`)
            return
          }
          e.stopPropagation()
          editor.select(`obj:${object.id}`)
          if (follow) return
          const g = groupRef.current
          if (!g) return
          const pos: Vec3 = [g.position.x, g.position.y, g.position.z]
          if (!beginMeshDrag(e, pos, objectDragMode(e.shiftKey))) return
          capturePointer(e)
        }}
        onPointerMove={(e) => {
          if (!meshDrag.current) return
          e.stopPropagation()
          applyMeshDrag(e)
        }}
        onPointerUp={(e) => {
          if (!meshDrag.current) return
          meshDrag.current = null
          releasePointer(e)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <primitive object={object.root} />
      </group>
      {selected && tool === 'select' && editing && !tech && !follow && !locked && (
        <ObjectGizmo groupRef={groupRef} onChange={syncTransform} />
      )}
    </>
  )
}

export function SceneObjects() {
  const objects = useSceneStore((s) => s.objects)
  return (
    <>
      {objects.map((object) => (
        <ObjectNode key={object.id} object={object} />
      ))}
    </>
  )
}
