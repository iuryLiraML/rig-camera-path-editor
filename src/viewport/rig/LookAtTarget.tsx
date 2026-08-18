import { useMemo, useRef } from 'react'
import { useCameraReady } from '../../state/cameraPathLink'
import * as THREE from 'three'
import { TransformControls } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEditorStore } from '../../state/useEditorStore'
import { useRigStore } from '../../state/useRigStore'
import { useSceneStore, type Vec3 } from '../../state/useSceneStore'
import { usePathStore } from '../../state/usePathStore'
import { evalVec3 } from '../../lib/keyframes'
import { evalObjectWorldTransform, resolveTrackTarget } from '../../lib/objectMotion'
import { localPointToWorld } from '../../lib/pathSpace'
import { useEditorOnly } from '../../lib/editorOnly'
import { useScreenScale } from '../../lib/screenScale'
import { isTechMode } from '../RenderPasses'
import { writeLookAt } from '../../lib/lookAtWrite'
import { cinemaCameraRef } from './CinemaCamera'

export function LookAtTarget() {
  const target = useRigStore((s) => s.target)
  const targetKeys = useRigStore((s) => s.targetKeys)
  const lookOffset = useRigStore((s) => s.lookOffset)
  const lookOffsetKeys = useRigStore((s) => s.lookOffsetKeys)
  const t = useRigStore((s) => s.t)
  const ease = useRigStore((s) => s.ease)
  const targetObjectId = useRigStore((s) => s.targetObjectId)
  const objects = useSceneStore((s) => s.objects)
  const paths = usePathStore((s) => s.paths)
  const lookAtMode = useRigStore((s) => s.lookAtMode)
  const cameraKind = useRigStore((s) => s.cameraKind)
  const hasPath = useCameraReady()
  const playMode = useEditorStore((s) => s.playMode)
  const cameraView = useEditorStore((s) => s.cameraView)
  const tech = useEditorStore((s) => isTechMode(s.viewMode))
  const selected = useEditorStore((s) => s.selection === 'target')
  const tool = useEditorStore((s) => s.tool)
  const track = resolveTrackTarget(targetObjectId, objects, paths)

  const position = track
    ? localPointToWorld(
        evalVec3(t, lookOffsetKeys, lookOffset, ease),
        evalObjectWorldTransform(t, track.object, track.path, ease),
      )
    : evalVec3(t, targetKeys, target, ease)

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
  const gizmoRef = useRef<THREE.Object3D>(null)
  useEditorOnly(handleRef)
  useEditorOnly(gizmoRef)
  useEditorOnly(lineRef)
  useScreenScale(sphereRef, 0.07)

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

  if (!hasPath || lookAtMode !== 'target' || playMode || tech || cameraKind === 'static') return null

  const showGizmo = selected && tool === 'select' && !cameraView

  return (
    <group>
      <group ref={handleRef} position={position}>
        <mesh
          ref={sphereRef}
          userData={{ pickKind: 'target', pickId: 'look-at' }}
          onPointerDown={(e: ThreeEvent<PointerEvent>) => {
            if (e.button !== 0) return
            e.stopPropagation()
            useEditorStore.getState().select('target')
          }}
        >
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial color={selected ? '#ffffff' : '#7c5cff'} depthTest={false} />
        </mesh>
      </group>
      {showGizmo && (
        <TransformControls
          ref={gizmoRef as never}
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
