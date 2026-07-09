import { useRef } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useEditorStore } from '../../state/useEditorStore'
import { useRigStore } from '../../state/useRigStore'
import { usePathStore, selectCameraAnchorCount } from '../../state/usePathStore'
import { useEditorOnly } from '../../lib/editorOnly'
import { useScreenScale } from '../../lib/screenScale'
import { isTechMode } from '../RenderPasses'
import { capturePointer, releasePointer } from '../path/PenTool'

export function LookAtTarget() {
  const target = useRigStore((s) => s.target)
  const lookAtMode = useRigStore((s) => s.lookAtMode)
  const hasPath = usePathStore(selectCameraAnchorCount) >= 2
  const playMode = useEditorStore((s) => s.playMode)
  const tech = useEditorStore((s) => isTechMode(s.viewMode))
  const selected = useEditorStore((s) => s.selection === 'target')

  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const plane = useRef(new THREE.Plane())
  const hit = useRef(new THREE.Vector3())
  const dragging = useRef(false)
  const ref = useRef<THREE.Mesh>(null)
  useEditorOnly(ref)
  useScreenScale(ref, 0.09)

  if (!hasPath || lookAtMode !== 'target' || playMode || tech) return null

  return (
    <mesh
      ref={ref}
      position={target}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        if (e.button !== 0) return
        e.stopPropagation()
        useEditorStore.getState().select('target')
        plane.current.set(new THREE.Vector3(0, 1, 0), -target[1])
        dragging.current = true
        if (controls) controls.enabled = false
        capturePointer(e)
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const p = e.ray.intersectPlane(plane.current, hit.current)
        if (p) useRigStore.getState().setTarget([p.x, target[1], p.z])
      }}
      onPointerUp={(e) => {
        dragging.current = false
        if (controls) controls.enabled = true
        releasePointer(e)
      }}
    >
      <sphereGeometry args={[1, 16, 16]} />
      <meshBasicMaterial color={selected ? '#ffffff' : '#7c5cff'} depthTest={false} />
    </mesh>
  )
}
