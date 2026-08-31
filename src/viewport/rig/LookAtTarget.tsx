import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { GizmoControls } from '../GizmoControls'
import { useEditorStore } from '../../state/useEditorStore'
import { useRigStore } from '../../state/useRigStore'
import { useSceneStore, type Vec3 } from '../../state/useSceneStore'
import { usePathStore } from '../../state/usePathStore'
import { evalSeparatedVec3 } from '../../lib/vec3Axes'
import { evalObjectWorldTransform, resolveTrackTarget } from '../../lib/objectMotion'
import { localPointToWorld } from '../../lib/pathSpace'
import { useEditorOnly } from '../../lib/editorOnly'
import { useScreenScale } from '../../lib/screenScale'
import { isTechMode } from '../RenderPasses'
import { writeLookAt } from '../../lib/lookAtWrite'
import { cinemaCameraRef } from './CinemaCamera'

const HANDLE_VISUAL_SCALE = 0.07
const HANDLE_PICK_SCALE = 0.18

function ignoreRaycast() {
  // Visual only — the larger pick sphere owns the click.
}

export function LookAtTarget() {
  const target = useRigStore((s) => s.target)
  const targetXKeys = useRigStore((s) => s.targetXKeys)
  const targetYKeys = useRigStore((s) => s.targetYKeys)
  const targetZKeys = useRigStore((s) => s.targetZKeys)
  const lookOffset = useRigStore((s) => s.lookOffset)
  const lookOffsetXKeys = useRigStore((s) => s.lookOffsetXKeys)
  const lookOffsetYKeys = useRigStore((s) => s.lookOffsetYKeys)
  const lookOffsetZKeys = useRigStore((s) => s.lookOffsetZKeys)
  const t = useRigStore((s) => s.t)
  const ease = useRigStore((s) => s.ease)
  const targetObjectId = useRigStore((s) => s.targetObjectId)
  const objects = useSceneStore((s) => s.objects)
  const paths = usePathStore((s) => s.paths)
  const lookAtMode = useRigStore((s) => s.lookAtMode)
  const playMode = useEditorStore((s) => s.playMode)
  const cameraView = useEditorStore((s) => s.cameraView)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const tech = useEditorStore((s) => isTechMode(s.viewMode))
  const selected = useEditorStore((s) => s.selection === 'target')
  const tool = useEditorStore((s) => s.tool)
  const targetHidden = useEditorStore((s) => s.hiddenIds.includes('target'))
  const track = resolveTrackTarget(targetObjectId, objects, paths)

  const position = track
    ? localPointToWorld(
        evalSeparatedVec3(t, lookOffsetXKeys, lookOffsetYKeys, lookOffsetZKeys, lookOffset, ease),
        evalObjectWorldTransform(t, track.object, track.path, ease),
      )
    : evalSeparatedVec3(t, targetXKeys, targetYKeys, targetZKeys, target, ease)

  const dragging = useRef(false)
  const handleRef = useRef<THREE.Group>(null)
  const sphereRef = useRef<THREE.Mesh>(null)
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    const material = new THREE.LineBasicMaterial({ color: 0x7c5cff, depthTest: false })
    return new THREE.Line(geometry, material)
  }, [])
  const lineRef = useRef<THREE.Line>(line)
  lineRef.current = line
  const pickRef = useRef<THREE.Mesh>(null)
  useEditorOnly(handleRef)
  useEditorOnly(lineRef)
  useScreenScale(sphereRef, HANDLE_VISUAL_SCALE)
  useScreenScale(pickRef, HANDLE_PICK_SCALE)

  useFrame(() => {
    if (!dragging.current && handleRef.current) {
      handleRef.current.position.set(...position)
    }
    const cam = cinemaCameraRef.current
    if (!cam) return
    const attr = line.geometry.getAttribute('position')
    attr.setXYZ(0, cam.position.x, cam.position.y, cam.position.z)
    const p = handleRef.current?.position ?? { x: position[0], y: position[1], z: position[2] }
    attr.setXYZ(1, p.x, p.y, p.z)
    attr.needsUpdate = true
  })

  if (lookAtMode !== 'target' || playMode || workspaceMode === 'visualize' || tech || targetHidden) {
    return null
  }

  const showGizmo = selected && tool === 'select' && !cameraView

  return (
    <group>
      <group ref={handleRef} position={position}>
        <mesh
          ref={pickRef}
          userData={{ pickKind: 'target', pickId: 'look-at' }}
          onPointerDown={(e: ThreeEvent<PointerEvent>) => {
            if (e.button !== 0) return
            e.stopPropagation()
            const editor = useEditorStore.getState()
            editor.select('target')
            editor.setKeyableFocus(track ? 'lookOffsetX' : 'targetX')
          }}
        >
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
        </mesh>
        <mesh ref={sphereRef} raycast={ignoreRaycast}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial color={selected ? '#ffffff' : '#7c5cff'} depthTest={false} />
        </mesh>
      </group>
      {showGizmo && (
        <GizmoControls
          object={handleRef as React.RefObject<THREE.Group>}
          mode="translate"
          size={0.65}
          onMouseDown={() => {
            dragging.current = true
            useRigStore.getState().setPlaying(false)
          }}
          onMouseUp={() => {
            dragging.current = false
          }}
          onObjectChange={() => {
            const handle = handleRef.current
            if (!handle) return
            const world: Vec3 = [handle.position.x, handle.position.y, handle.position.z]
            writeLookAt(world)
          }}
        />
      )}
      {!cameraView && <primitive object={line} />}
    </group>
  )
}
