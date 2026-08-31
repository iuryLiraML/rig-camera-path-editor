import { useEffect, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import {
  applyDummyBoneWorldTransform,
  findDummyBone,
  listDummyPoseBones,
  type DummyBoneName,
} from '../lib/dummyCharacter'
import { useEditorOnly } from '../lib/editorOnly'
import { GizmoControls } from './GizmoControls'

const HANDLE_R = 0.045

/**
 * Joint spheres select a bone. The W/E gizmo rides a world-space proxy so
 * TransformControls never decomposes onto the skinned bone (that blew the mesh).
 */
export function DummyPoseHandles({
  root,
  focus,
  onFocus,
}: {
  root: THREE.Object3D
  focus: DummyBoneName | null
  onFocus: (name: DummyBoneName | null) => void
}) {
  const { camera, gl, raycaster } = useThree()
  const groupRef = useRef<THREE.Group>(null)
  const meshes = useRef<Partial<Record<DummyBoneName, THREE.Mesh>>>({})
  const focusRef = useRef(focus)
  const onFocusRef = useRef(onFocus)
  focusRef.current = focus
  onFocusRef.current = onFocus
  useEditorOnly(groupRef)

  const bones = useMemo(() => listDummyPoseBones(root), [root])
  const tmp = useRef({
    ndc: new THREE.Vector2(),
    scale: new THREE.Vector3(),
  }).current

  useEffect(() => {
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return
      const rect = gl.domElement.getBoundingClientRect()
      tmp.ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(tmp.ndc, camera)
      const list = bones.map((name) => meshes.current[name]).filter(
        (mesh): mesh is THREE.Mesh => mesh != null && mesh.visible,
      )
      const hits = raycaster.intersectObjects(list, false)
      if (!hits.length) return
      const name = hits[0].object.userData.dummyBone as DummyBoneName | undefined
      if (!name || name === focusRef.current) return
      ev.stopPropagation()
      ev.preventDefault()
      onFocusRef.current(name)
    }
    gl.domElement.addEventListener('pointerdown', onDown)
    return () => {
      gl.domElement.removeEventListener('pointerdown', onDown)
    }
  }, [bones, camera, gl, raycaster, tmp])

  useFrame(() => {
    root.getWorldScale(tmp.scale)
    const handleScale = Math.max(tmp.scale.x, 0.35)
    for (const name of bones) {
      const mesh = meshes.current[name]
      const bone = findDummyBone(root, name)
      if (!mesh || !bone) {
        if (mesh) mesh.visible = false
        continue
      }
      bone.getWorldPosition(mesh.position)
      mesh.scale.setScalar(handleScale)
      const active = focusRef.current === name
      mesh.visible = !active
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.color.set('#d0d0d0')
      mat.opacity = 0.55
    }
  })

  return (
    <group ref={groupRef} userData={{ pickKind: 'gizmo' }}>
      {bones.map((name) => (
        <mesh
          key={name}
          visible={false}
          ref={(node) => {
            if (node) meshes.current[name] = node
            else delete meshes.current[name]
          }}
          userData={{ pickKind: 'gizmo', dummyBone: name }}
        >
          <sphereGeometry args={[HANDLE_R, 12, 10]} />
          <meshBasicMaterial color="#d0d0d0" transparent opacity={0.55} depthTest={false} />
        </mesh>
      ))}
    </group>
  )
}

export function DummyJointGizmo({
  root,
  boneName,
  mode,
  onChange,
  onDragStart,
  onDragEnd,
}: {
  root: THREE.Object3D
  boneName: DummyBoneName
  mode: 'translate' | 'rotate' | 'scale'
  onChange: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const proxyRef = useRef<THREE.Group>(null)
  const dragging = useRef(false)
  const boneMode = mode === 'scale' ? 'rotate' : mode
  const worldPos = useRef(new THREE.Vector3())
  const worldQuat = useRef(new THREE.Quaternion())

  useFrame(() => {
    const bone = findDummyBone(root, boneName)
    const proxy = proxyRef.current
    if (!bone || !proxy || dragging.current) return
    bone.getWorldPosition(proxy.position)
    bone.getWorldQuaternion(proxy.quaternion)
    proxy.scale.set(1, 1, 1)
  })

  const mapProxyToBone = () => {
    const bone = findDummyBone(root, boneName)
    const proxy = proxyRef.current
    if (!bone || !proxy) return
    proxy.getWorldPosition(worldPos.current)
    proxy.getWorldQuaternion(worldQuat.current)
    applyDummyBoneWorldTransform(bone, worldPos.current, worldQuat.current, boneMode)
  }

  return (
    <>
      <group ref={proxyRef} userData={{ pickKind: 'gizmo' }} />
      <GizmoControls
        object={proxyRef as RefObject<THREE.Group>}
        mode={boneMode}
        space={boneMode === 'rotate' ? 'local' : 'world'}
        size={0.55}
        onMouseDown={() => {
          dragging.current = true
          onDragStart()
        }}
        onMouseUp={() => {
          dragging.current = false
          mapProxyToBone()
          onChange()
          onDragEnd()
        }}
        onObjectChange={mapProxyToBone}
      />
    </>
  )
}
