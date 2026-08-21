import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { PerspectiveCamera } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEditorStore } from '../../state/useEditorStore'
import { useRigStore } from '../../state/useRigStore'
import { useCameraPath } from '../../state/cameraPathLink'
import { buildCurve } from '../../lib/curve'
import { cinemaChannelsFromRig } from '../../lib/cinemaChannels'
import { evaluateCinemaPose } from '../../lib/evaluateCinemaPose'
import { useSceneStore } from '../../state/useSceneStore'
import { usePathStore } from '../../state/usePathStore'
import { useEditorOnly } from '../../lib/editorOnly'
import { useScreenScale } from '../../lib/screenScale'
import { applyCanvasAspect } from '../../lib/staticCamera'
import { isTechMode } from '../RenderPasses'
import { CAMERA_ICON_COLOR, CAMERA_ICON_SELECTED } from '../viewportLook'

function ignoreRaycast() {
  // Visual wire only — the body sphere is the pick volume.
}

function CameraFrustum({ selected }: { selected: boolean }) {
  const color = selected ? CAMERA_ICON_SELECTED : CAMERA_ICON_COLOR
  const geo = useMemo(() => {
    const near = 0.08
    const far = 0.36
    const nw = 0.09
    const nh = 0.06
    const fw = 0.2
    const fh = 0.135
    const positions = new Float32Array([
      -nw, -nh, -near, nw, -nh, -near, nw, nh, -near, -nw, nh, -near,
      -fw, -fh, -far, fw, -fh, -far, fw, fh, -far, -fw, fh, -far,
    ])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setIndex([0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7])
    return g
  }, [])
  const up = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-0.05, 0.06, -0.08, 0.05, 0.06, -0.08, 0, 0.13, -0.08]), 3),
    )
    return g
  }, [])

  return (
    <group>
      <lineSegments geometry={geo} raycast={ignoreRaycast}>
        <lineBasicMaterial color={color} depthTest={false} />
      </lineSegments>
      <mesh geometry={up} raycast={ignoreRaycast}>
        <meshBasicMaterial color={color} depthTest={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/** Shared handle so the PiP preview can render through this camera. */
export const cinemaCameraRef: { current: THREE.PerspectiveCamera | null } = { current: null }

export function CinemaCamera() {
  const camPath = useCameraPath()
  const anchors = camPath?.anchors ?? []
  const closed = camPath?.closed ?? false
  const rounding = camPath?.rounding ?? 0.8
  const fov = useRigStore((s) => s.fov)
  const cameraKind = useRigStore((s) => s.cameraKind)
  const playMode = useEditorStore((s) => s.playMode)
  const cameraView = useEditorStore((s) => s.cameraView)
  const tech = useEditorStore((s) => isTechMode(s.viewMode))
  const selected = useEditorStore((s) => s.selection === 'cinema-camera')

  const camRef = useRef<THREE.PerspectiveCamera>(null)
  const bodyRef = useRef<THREE.Group>(null)

  const curve = useMemo(() => buildCurve(anchors, closed, rounding), [anchors, closed, rounding])
  const ready = Boolean(curve) || cameraKind === 'static'

  useEditorOnly(bodyRef)
  useScreenScale(bodyRef, 1)

  useFrame((state, delta) => {
    const cam = camRef.current
    cinemaCameraRef.current = cam
    if (!cam || !ready) return
    const rig = useRigStore.getState()

    let t = rig.t
    if (rig.playing) {
      t += delta / rig.duration
      if (t > 1) {
        if (rig.loop) t %= 1
        else {
          t = 1
          rig.setPlaying(false)
        }
      }
      rig.setT(t)
    }

    const pose = evaluateCinemaPose(
      t,
      { anchors, closed, rounding },
      cinemaChannelsFromRig(rig, {
        objects: useSceneStore.getState().objects,
        paths: usePathStore.getState().paths,
      }),
    )
    if (!pose) return
    cam.position.set(...pose.position)
    cam.quaternion.set(...pose.quaternion)
    const body = bodyRef.current
    if (body) {
      body.position.copy(cam.position)
      body.quaternion.copy(cam.quaternion)
    }
    if (playMode || cameraView) {
      applyCanvasAspect(cam, state.size.width, state.size.height)
    }
    if (Math.abs(cam.fov - pose.fov) > 1e-3) {
      cam.fov = pose.fov
      cam.updateProjectionMatrix()
    }
  })

  if (!ready) return null

  return (
    <>
      <PerspectiveCamera
        ref={camRef}
        makeDefault={playMode || cameraView}
        fov={fov}
        near={0.05}
        far={200}
      />
      {/* Must live in the scene, not as a child of PerspectiveCamera: R3F
          raycast skips a camera's subtree, so a click on the icon would
          fall through onto whatever mesh sits behind it. */}
      <group
        ref={bodyRef}
        userData={{ pickKind: 'camera', pickId: 'cinema-camera' }}
        visible={!playMode && !cameraView && !tech}
        frustumCulled={false}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.stopPropagation()
          useEditorStore.getState().select('cinema-camera')
          useEditorStore.getState().setTool('select')
        }}
      >
        <mesh position={[0, 0, -0.14]} frustumCulled={false}>
          <sphereGeometry args={[0.18, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
        </mesh>
        <CameraFrustum selected={selected} />
      </group>
    </>
  )
}
