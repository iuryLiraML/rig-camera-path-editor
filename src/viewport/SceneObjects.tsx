import { useSolidSelectionStore } from '../state/useSolidSelectionStore'
import { selectSolidSurface, SolidSelection } from './SolidSelection'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useCursor } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { clipPlayheadSeconds } from '../lib/clipClock'
import {
  applyDummyBonePose,
  commitDummyFk,
  dummyBoneFromHit,
  dummyBoneFromObject,
  isDummyBoneName,
} from '../lib/dummyCharacter'
import { DummyJointGizmo, DummyPoseHandles } from './DummyPoseHandles'
import { aimObject } from '../lib/cameraOrientation'
import { buildCurve, clamp01 } from '../lib/curve'
import { evalModelTransform, type ObjectChannel } from '../lib/keyframes'
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
import { pickKindOf } from '../lib/viewportPick'
import { eventShiftHeld } from '../lib/pointerNdc'
import { isSceneEditing } from '../lib/workspaceChrome'
import { writeObjectTransform } from '../lib/autoKey'
import { isObjectGizmoActive, isTechMode, useEditorStore } from '../state/useEditorStore'
import { collapsePointerPick, pointerPickMember } from '../state/selectionPick'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore, type SceneObject, type Vec3 } from '../state/useSceneStore'
import { GizmoControls } from './GizmoControls'
import { capturePointer, releasePointer } from './path/PenTool'
import { applyAssetDisplay } from '../lib/assetDisplay'
import { PATH_SELECTED_HALO } from '../lib/pathVisual'
import { objectSelectionChrome } from '../lib/selectionChrome'

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

const BOUNDS_THROTTLE_FRAMES = 8
let boundsCache: { box: THREE.Box3; atFrame: number; objectCount: number } | null = null

export function invalidateSceneBoundsCache() {
  boundsCache = null
}

/** sceneBounds() is O(objects) — throttle for depth/normals auto-range (every N frames). */
export function sceneBoundsThrottled(frame: number): THREE.Box3 | null {
  const objectCount = objectGroups.size
  if (
    boundsCache &&
    boundsCache.objectCount === objectCount &&
    frame - boundsCache.atFrame < BOUNDS_THROTTLE_FRAMES
  ) {
    return boundsCache.box
  }
  const fresh = sceneBounds()
  if (!fresh) {
    boundsCache = null
    return null
  }
  boundsCache = { box: fresh, atFrame: frame, objectCount }
  return fresh
}

function ObjectGizmo({
  targetRef,
  mode,
  onChange,
  onDragStart,
  onDragEnd,
}: {
  targetRef: React.RefObject<THREE.Object3D | null>
  mode: 'translate' | 'rotate' | 'scale'
  onChange: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const snapEnabled = useEditorStore((s) => s.snapEnabled)
  const gridSize = useEditorStore((s) => s.gridSize)
  return (
    <GizmoControls
      object={targetRef as React.RefObject<THREE.Group>}
      mode={mode}
      size={0.65}
      translationSnap={snapEnabled ? gridSize : undefined}
      onMouseDown={onDragStart}
      onMouseUp={onDragEnd}
      onObjectChange={onChange}
    />
  )
}

function ignoreRaycast() {}

function ObjectSelectionHalo({ target }: { target: React.RefObject<THREE.Group | null> }) {
  const helper = useMemo(() => new THREE.BoxHelper(new THREE.Object3D(), PATH_SELECTED_HALO), [])
  useFrame(() => {
    const obj = target.current
    if (!obj || !obj.visible) {
      helper.visible = false
      return
    }
    helper.visible = true
    helper.setFromObject(obj)
  })
  return <primitive object={helper} raycast={ignoreRaycast} />
}

function ObjectNode({ object }: { object: SceneObject }) {
  const solidMode = useSolidSelectionStore((s) => s.mode)
  const objectContextActive = useEditorStore((s) => isObjectGizmoActive(s.selection, object.id))
  const selectedMember = useEditorStore((s) => s.selectionIds.includes(`obj:${object.id}`))
  const showPoseHandles = useEditorStore((s) => s.showPoseHandles)
  const dummyBone = useEditorStore((s) => (s.selection === `obj:${object.id}` ? s.dummyBone : null))
  const gizmoMode = useEditorStore((s) => s.gizmoMode)
  const tool = useEditorStore((s) => s.tool)
  const playMode = useEditorStore((s) => s.playMode)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const locked = useEditorStore((s) => s.lockedIds.includes(object.id))
  const showSceneObjects = useEditorStore((s) => s.showSceneObjects)
  const objectHidden = useEditorStore((s) => s.hiddenIds.includes(`obj:${object.id}`))
  const editing = isSceneEditing(playMode, workspaceMode)
  const viewMode = useEditorStore((s) => s.viewMode)
  const recording = useEditorStore((s) => s.recording)
  const tech = isTechMode(viewMode)
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef<THREE.Group>(null)
  const gizmoDragging = useRef(false)
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

  useEffect(() => {
    applyAssetDisplay(object, viewMode, recording ? 'export' : 'live')
  }, [object, object.root, object.displayMode, recording, viewMode])

  useEffect(() => {
    if (object.rigKind !== 'dummy' || object.playClips) return
    applyDummyBonePose(object.root, object.bonePose, object.boneTranslate)
  }, [object.rigKind, object.playClips, object.bonePose, object.boneTranslate, object.root])

  const chrome = objectSelectionChrome({ selected: selectedMember && editing })

  // hover lift only — selection uses overlay chrome, not clay emissive
  useEffect(() => {
    const emissive = !editing ? 0 : selectedMember ? chrome.clayEmissive : hovered ? 0.05 : 0
    object.material.emissive.setScalar(emissive)
    object.wireframeMaterial.emissive.setScalar(emissive)
  }, [object.material, object.wireframeMaterial, selectedMember, hovered, editing, chrome.clayEmissive])

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    objectGroups.set(object.id, group)
    invalidateSceneBoundsCache()
    return () => {
      objectGroups.delete(object.id)
      invalidateSceneBoundsCache()
    }
  }, [object.id, object.root])

  useEffect(() => {
    object.clips.forEach((clip) => mixer.clipAction(clip).stop())
    const active =
      object.activeClip && object.clips.some((clip) => clip.name === object.activeClip)
        ? object.clips.filter((clip) => clip.name === object.activeClip)
        : object.rigKind === 'dummy'
          ? object.clips.filter((clip) => clip.name === 'Idle')
          : object.clips
    active.forEach((clip) => mixer.clipAction(clip).play())
    return () => {
      mixer.stopAllAction()
    }
  }, [mixer, object.clips, object.activeClip, object.rigKind])

  // store -> group for rest-pose objects; keyed objects are driven in useFrame
  useEffect(() => {
    if (object.keys.length > 0) return
    const g = groupRef.current
    if (!g) return
    const t = object.transform
    g.position.set(...t.position)
    g.rotation.set(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG)
    g.scale.set(...t.scale)
  }, [object.transform, object.keys.length])

  useFrame(() => {
    const rig = useRigStore.getState()

    if (object.playClips && object.clips.length > 0) {
      mixer.setTime(clipPlayheadSeconds(rig.t, rig.duration, object.clips, object.activeClip))
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
    if (gizmoDragging.current || meshDrag.current) return

    const pose = evalModelTransform(rig.t, object.keys, rig.ease, object.transform)
    const g = groupRef.current
    if (!pose || !g) return
    g.position.set(...pose.position)
    g.rotation.set(pose.rotation[0] * DEG, pose.rotation[1] * DEG, pose.rotation[2] * DEG)
    g.scale.set(...pose.scale)
  })

  const syncTransform = (channels?: ObjectChannel[]) => {
    const g = groupRef.current
    if (!g) return
    const mode = useEditorStore.getState().gizmoMode
    const channel =
      mode === 'rotate' ? 'rotation' : mode === 'scale' ? 'scale' : 'position'
    writeObjectTransform(
      object.id,
      {
        position: g.position.toArray() as Vec3,
        rotation: [g.rotation.x * RAD, g.rotation.y * RAD, g.rotation.z * RAD],
        scale: g.scale.toArray() as Vec3,
      },
      channels ?? [channel],
    )
  }

  const syncBonePose = () => {
    if (object.rigKind !== 'dummy') return
    commitDummyFk(object.id)
  }

  const meshDrag = useRef<{
    mode: ObjectDragMode
    keep: Vec3
    planePoint: Vec3
    planeNormal: Vec3
    grab: Vec3
    startClient: [number, number]
    moved: boolean
    collapseTo: `obj:${string}` | null
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
      collapseTo: meshDrag.current?.collapseTo ?? null,
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
    syncTransform(['position'])
  }

  return (
    <>
      <group
        ref={groupRef}
        visible={showSceneObjects && !objectHidden}
        userData={{ pickKind: 'object', pickId: `obj:${object.id}` }}
        onPointerDown={(e) => {
          const editor = useEditorStore.getState()
          if (editor.cameraView) return
          if (editor.tool !== 'select' || !isSceneEditing(editor.playMode, editor.workspaceMode) || e.button !== 0) return
          if (
            e.intersections.some((hit) => {
              const kind = pickKindOf(hit.object)
              return kind === 'gizmo' || kind === 'target'
            })
          ) {
            return
          }
          if (useEditorStore.getState().lockedIds.includes(object.id)) {
            e.stopPropagation()
            pointerPickMember(`obj:${object.id}`, { additive: eventShiftHeld(e) })
            return
          }
          e.stopPropagation()
          if (object.primitive && useSolidSelectionStore.getState().mode !== 'body' && e.object instanceof THREE.Mesh && e.faceIndex != null) {
            pointerPickMember(`obj:${object.id}`, { additive: false })
            selectSolidSurface(object, e.object, e.faceIndex, e.point)
            return
          }
          const member = `obj:${object.id}` as const
          const alreadySelected = editor.selectionIds.includes(member)
          const action = pointerPickMember(member, { additive: eventShiftHeld(e) })
          if (showPoseHandles && object.rigKind === 'dummy' && alreadySelected && action === 'replace') {
            const limb = dummyBoneFromObject(e.object) ?? dummyBoneFromHit(object.root, e.point)
            if (limb) {
              editor.setDummyBone(limb)
              if (object.playClips) useSceneStore.getState().setPlayClips(object.id, false)
              return
            }
            editor.setDummyBone(null)
          }
          if (follow) return
          const g = groupRef.current
          if (!g) return
          const pos: Vec3 = [g.position.x, g.position.y, g.position.z]
          if (!beginMeshDrag(e, pos, objectDragMode(e.shiftKey))) return
          if (meshDrag.current) {
            meshDrag.current.collapseTo = action === 'keep-group' ? member : null
          }
          capturePointer(e)
        }}
        onPointerMove={(e) => {
          if (!meshDrag.current) return
          e.stopPropagation()
          applyMeshDrag(e)
        }}
        onPointerUp={(e) => {
          if (!meshDrag.current) return
          const collapseTo = !meshDrag.current.moved ? meshDrag.current.collapseTo : null
          meshDrag.current = null
          releasePointer(e)
          if (collapseTo) collapsePointerPick(collapseTo)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <primitive key={object.root.uuid} object={object.root} />
        {object.primitive && selectedMember && editing && !recording && !tech && <SolidSelection object={object} />}
      </group>
      {chrome.outline && showSceneObjects && !objectHidden && (
        <ObjectSelectionHalo target={groupRef} />
      )}
      {objectContextActive && showPoseHandles &&
        object.rigKind === 'dummy' &&
        editing &&
        !tech &&
        !object.playClips &&
        showSceneObjects &&
        !objectHidden && (
        <DummyPoseHandles
          root={object.root}
          focus={dummyBone && isDummyBoneName(dummyBone) ? dummyBone : null}
          onFocus={(name) => {
            useEditorStore.getState().setDummyBone(name)
            if (name) useSceneStore.getState().setPlayClips(object.id, false)
          }}
        />
      )}
      {objectContextActive && showPoseHandles &&
        tool === 'select' &&
        object.rigKind === 'dummy' &&
        dummyBone &&
        isDummyBoneName(dummyBone) &&
        editing &&
        !tech &&
        !object.playClips &&
        showSceneObjects &&
        !objectHidden && (
          <DummyJointGizmo
            root={object.root}
            boneName={dummyBone}
            mode={gizmoMode}
            onChange={syncBonePose}
            onDragStart={() => {
              gizmoDragging.current = true
            }}
            onDragEnd={() => {
              gizmoDragging.current = false
            }}
          />
        )}
      {objectContextActive && (!object.primitive || solidMode === 'body') && tool === 'select' && editing && !tech && !follow && !locked && !dummyBone && (
        <ObjectGizmo
          targetRef={groupRef}
          mode={gizmoMode}
          onChange={syncTransform}
          onDragStart={() => {
            gizmoDragging.current = true
          }}
          onDragEnd={() => {
            gizmoDragging.current = false
          }}
        />
      )}
    </>
  )
}

export function SceneObjects() {
  const objects = useSceneStore((s) => s.objects)
  return (
    <>
      {objects.map((object) => (
        <ObjectNode key={`${object.id}:${object.root.uuid}`} object={object} />
      ))}
    </>
  )
}
