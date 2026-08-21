import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { TransformControls } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { evalVec3 } from '../../lib/keyframes'
import { writeLookAt } from '../../lib/lookAtWrite'
import { evalObjectWorldTransform, resolveTrackTarget } from '../../lib/objectMotion'
import { localPointToWorld } from '../../lib/pathSpace'
import { lockOrbit, unlockOrbit } from '../../lib/orbitLock'
import { truckOnGround } from '../../lib/planeDrag'
import { writeStaticPose } from '../../lib/autoKey'
import { applyPoseToObject, eulerDegFromQuaternion, poseFromObject } from '../../lib/staticCamera'
import { useEditorOnly } from '../../lib/editorOnly'
import { useScreenScale } from '../../lib/screenScale'
import { useRigStore } from '../../state/useRigStore'
import { useEditorStore } from '../../state/useEditorStore'
import { usePathStore } from '../../state/usePathStore'
import { useSceneStore, type Vec3 } from '../../state/useSceneStore'
import { isTechMode } from '../RenderPasses'
import { capturePointer, releasePointer } from '../path/PenTool'
import { RIG_ORANGE, RingHandle, type RingHandleKind } from './RingHandle'

type DragKind = RingHandleKind

function currentLookPoint(): Vec3 {
  const rig = useRigStore.getState()
  const scene = {
    objects: useSceneStore.getState().objects,
    paths: usePathStore.getState().paths,
  }
  const track = resolveTrackTarget(rig.targetObjectId, scene.objects, scene.paths)
  if (track) {
    return localPointToWorld(
      evalVec3(rig.t, rig.lookOffsetKeys, rig.lookOffset, rig.ease),
      evalObjectWorldTransform(rig.t, track.object, track.path, rig.ease),
    )
  }
  return evalVec3(rig.t, rig.targetKeys, rig.target, rig.ease)
}

function restoreOrbit() {
  unlockOrbit()
}

/**
 * Authoring rig for a pathless camera, Unreal/Maya style:
 * - the frustum icon (CinemaCamera) is the body; clicking it — or the pick
 *   sphere here — selects the camera and brings up the standard
 *   TransformControls gizmo (W move, E rotate; rotate only in Free, because
 *   Target derives orientation from the look-at point);
 * - a small floor pad trucks camera + target together on XZ;
 * - the diamond handle drags the look-at point (Target only).
 */
export function CameraRig() {
  const cameraKind = useRigStore((s) => s.cameraKind)
  const lookAtMode = useRigStore((s) => s.lookAtMode)
  const playMode = useEditorStore((s) => s.playMode)
  const cameraView = useEditorStore((s) => s.cameraView)
  const tech = useEditorStore((s) => isTechMode(s.viewMode))
  const selected = useEditorStore((s) => s.selection === 'cinema-camera')
  const tool = useEditorStore((s) => s.tool)
  const gizmoMode = useEditorStore((s) => s.gizmoMode)

  const controls = useThree((s) => s.controls) as { enabled: boolean } | null

  const rootRef = useRef<THREE.Group>(null)
  const proxyRef = useRef<THREE.Group>(null)
  const gizmoRef = useRef<THREE.Object3D>(null)
  const pickRef = useRef<THREE.Mesh>(null)
  const groundHandle = useRef<THREE.Group>(null)
  const targetHandle = useRef<THREE.Group>(null)
  const dropRef = useRef<THREE.Line>(null)
  const aimRef = useRef<THREE.Line>(null)
  const gizmoDragging = useRef(false)
  const drag = useRef<{
    kind: DragKind
    startCam: Vec3
    startTarget: Vec3
    startGround: Vec3
    plane: THREE.Plane
    grab: THREE.Vector3
  } | null>(null)

  const drop = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    const material = new THREE.LineDashedMaterial({
      color: RIG_ORANGE,
      dashSize: 0.1,
      gapSize: 0.1,
      depthTest: false,
      transparent: true,
      opacity: 0.4,
    })
    const line = new THREE.Line(geometry, material)
    line.computeLineDistances()
    return line
  }, [])

  const aim = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    const material = new THREE.LineBasicMaterial({
      color: RIG_ORANGE,
      depthTest: false,
      transparent: true,
      opacity: 0.32,
    })
    return new THREE.Line(geometry, material)
  }, [])

  useEditorOnly(rootRef)
  useEditorOnly(gizmoRef)
  useEditorOnly(dropRef)
  useEditorOnly(aimRef)
  useScreenScale(pickRef, 0.07)

  useFrame(() => {
    const rig = useRigStore.getState()
    const pose = {
      position: evalVec3(rig.t, rig.staticPosKeys, rig.staticPose.position, rig.ease),
      rotation: evalVec3(rig.t, rig.staticRotKeys, rig.staticPose.rotation, rig.ease),
    }
    const look = currentLookPoint()
    if (proxyRef.current && !gizmoDragging.current) {
      applyPoseToObject(proxyRef.current, pose)
    }
    if (!drag.current) {
      if (groundHandle.current) {
        groundHandle.current.position.set(pose.position[0], 0, pose.position[2])
      }
      if (targetHandle.current) targetHandle.current.position.set(...look)
    }

    const [ex, ey, ez] = pose.position
    const dropAttr = drop.geometry.getAttribute('position')
    dropAttr.setXYZ(0, ex, ey, ez)
    dropAttr.setXYZ(1, ex, 0, ez)
    dropAttr.needsUpdate = true
    drop.computeLineDistances()

    const aimAttr = aim.geometry.getAttribute('position')
    aimAttr.setXYZ(0, ex, ey, ez)
    aimAttr.setXYZ(1, look[0], look[1], look[2])
    aimAttr.needsUpdate = true
  })

  const beginDrag = (kind: DragKind, e: ThreeEvent<PointerEvent>, handle: Vec3) => {
    useEditorStore.getState().select(kind === 'target' ? 'target' : 'cinema-camera')
    useRigStore.getState().setPlaying(false)
    const pose = useRigStore.getState().staticPose
    const startTarget = currentLookPoint()
    const plane = new THREE.Plane()
    if (kind === 'ground') {
      plane.set(new THREE.Vector3(0, 1, 0), 0)
    } else {
      const n = new THREE.Vector3()
      e.camera.getWorldDirection(n)
      plane.setFromNormalAndCoplanarPoint(n, new THREE.Vector3(...handle))
    }
    const hit = new THREE.Vector3()
    e.ray.intersectPlane(plane, hit)
    const grab = new THREE.Vector3(...handle).sub(hit)
    drag.current = {
      kind,
      startCam: [...pose.position],
      startTarget,
      startGround: [pose.position[0], 0, pose.position[2]],
      plane,
      grab,
    }
    lockOrbit()
    if (controls) controls.enabled = false
    capturePointer(e)
  }

  const moveDrag = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d) return
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(d.plane, hit)) return
    const next: Vec3 = [hit.x + d.grab.x, hit.y + d.grab.y, hit.z + d.grab.z]
    switch (d.kind) {
      case 'ground': {
        const trucked = truckOnGround(d.startCam, d.startTarget, d.startGround, next)
        writeStaticPose({ position: trucked.camera })
        if (lookAtMode === 'target') writeLookAt(trucked.target)
        if (groundHandle.current) {
          groundHandle.current.position.set(trucked.camera[0], 0, trucked.camera[2])
        }
        if (targetHandle.current) targetHandle.current.position.set(...trucked.target)
        break
      }
      case 'target':
        writeLookAt(next)
        if (targetHandle.current) targetHandle.current.position.set(...next)
        break
      default: {
        const _never: never = d.kind
        return _never
      }
    }
  }

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    drag.current = null
    restoreOrbit()
    releasePointer(e)
  }

  if (cameraKind !== 'static' || playMode || cameraView || tech) return null

  // Rotating makes no sense while Target owns the orientation; scale never does.
  const mode = gizmoMode === 'rotate' && lookAtMode === 'free' ? 'rotate' : 'translate'
  const showGizmo = selected && tool === 'select'

  return (
    <group ref={rootRef}>
      {/* camera body: proxy the gizmo moves + generous invisible pick target */}
      <group ref={proxyRef}>
        <mesh
          ref={pickRef}
          userData={{ pickKind: 'camera', pickId: 'cinema-camera' }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            useEditorStore.getState().select('cinema-camera')
            useEditorStore.getState().setTool('select')
          }}
        >
          <sphereGeometry args={[1, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      {showGizmo && (
        <TransformControls
          ref={gizmoRef as never}
          object={proxyRef as React.RefObject<THREE.Group>}
          mode={mode}
          size={0.65}
          onMouseDown={() => {
            gizmoDragging.current = true
            useRigStore.getState().setPlaying(false)
          }}
          onMouseUp={() => {
            gizmoDragging.current = false
          }}
          onObjectChange={() => {
            const proxy = proxyRef.current
            if (!proxy) return
            if (mode === 'rotate') {
              writeStaticPose({ rotation: eulerDegFromQuaternion(proxy.quaternion) })
            } else {
              writeStaticPose({ position: poseFromObject(proxy).position })
            }
          }}
        />
      )}
      <group ref={groundHandle}>
        <RingHandle
          kind="ground"
          billboard={false}
          onPointerDown={(e) => {
            const p = useRigStore.getState().staticPose.position
            beginDrag('ground', e, [p[0], 0, p[2]])
          }}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
        />
      </group>
      {lookAtMode === 'target' && (
        <group ref={targetHandle}>
          <RingHandle
            kind="target"
            billboard
            onPointerDown={(e) => beginDrag('target', e, currentLookPoint())}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
          />
        </group>
      )}
      <primitive ref={dropRef} object={drop} />
      {lookAtMode === 'target' && <primitive ref={aimRef} object={aim} />}
    </group>
  )
}
