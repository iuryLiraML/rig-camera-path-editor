import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { TransformControls, useCursor } from '@react-three/drei'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore, type SceneObject, type Vec3 } from '../state/useSceneStore'
import { useRigStore } from '../state/useRigStore'
import { usePathStore } from '../state/usePathStore'
import { evalModelTransform } from '../lib/keyframes'
import { aimObject } from '../lib/cameraOrientation'
import { buildCurve, clamp01 } from '../lib/curve'
import { useEditorOnly } from '../lib/editorOnly'
import { isTechMode } from './RenderPasses'

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

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
  const ref = useRef<THREE.Object3D>(null)
  useEditorOnly(ref)
  return (
    <TransformControls
      ref={ref as never}
      object={groupRef as React.RefObject<THREE.Group>}
      mode={gizmoMode}
      size={0.8}
      onObjectChange={onChange}
    />
  )
}

function ObjectNode({ object }: { object: SceneObject }) {
  const selected = useEditorStore((s) => s.selection === `obj:${object.id}`)
  const tool = useEditorStore((s) => s.tool)
  const playMode = useEditorStore((s) => s.playMode)
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

  useCursor(hovered && tool === 'select' && !playMode)

  // hover/selection feedback: a subtle grayscale lift, no color involved
  useEffect(() => {
    object.material.emissive.setScalar(
      playMode ? 0 : selected ? 0.1 : hovered ? 0.05 : 0,
    )
  }, [object.material, selected, hovered, playMode])

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

    const pose = evalModelTransform(rig.t, object.keys, rig.ease)
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

  return (
    <>
      <group
        ref={groupRef}
        onPointerDown={(e) => {
          const editor = useEditorStore.getState()
          if (editor.tool !== 'select' || editor.playMode || e.button !== 0) return
          e.stopPropagation()
          editor.select(`obj:${object.id}`)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <primitive object={object.root} />
      </group>
      {selected && tool === 'select' && !playMode && !tech && !follow && (
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
