import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { PerspectiveCamera } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEditorStore } from '../../state/useEditorStore'
import { useRigStore } from '../../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore } from '../../state/usePathStore'
import { buildCurve, clamp01 } from '../../lib/curve'
import { evalProgress } from '../../lib/keyframes'
import { useEditorOnly } from '../../lib/editorOnly'
import { useScreenScale } from '../../lib/screenScale'
import { isTechMode } from '../RenderPasses'

const DEG = Math.PI / 180
const ACCENT = '#3b82f6'

/** Shared handle so the PiP preview can render through this camera. */
export const cinemaCameraRef: { current: THREE.PerspectiveCamera | null } = { current: null }

export function CinemaCamera() {
  const camPath = usePathStore((s) => s.paths.find((p) => p.id === CAMERA_PATH_ID))
  const anchors = camPath?.anchors ?? []
  const closed = camPath?.closed ?? false
  const rounding = camPath?.rounding ?? 0.8
  const fov = useRigStore((s) => s.fov)
  const playMode = useEditorStore((s) => s.playMode)
  const cameraView = useEditorStore((s) => s.cameraView)
  const tech = useEditorStore((s) => isTechMode(s.viewMode))
  const selected = useEditorStore((s) => s.selection === 'cinema-camera')

  const camRef = useRef<THREE.PerspectiveCamera>(null)
  const bodyRef = useRef<THREE.Group>(null)
  const lookTarget = useRef(new THREE.Vector3())

  const curve = useMemo(() => buildCurve(anchors, closed, rounding), [anchors, closed, rounding])

  useEditorOnly(bodyRef)
  useScreenScale(bodyRef, 1)

  useFrame((_, delta) => {
    const cam = camRef.current
    cinemaCameraRef.current = cam
    if (!cam || !curve) return
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

    const eased = clamp01(evalProgress(clamp01(t), rig.progressKeys, rig.smoothness))
    cam.position.copy(curve.getPointAt(eased))

    if (rig.lookAtMode === 'target') {
      lookTarget.current.set(...rig.target)
    } else {
      lookTarget.current.copy(curve.getTangentAt(eased)).add(cam.position)
    }
    cam.up.set(0, 1, 0)
    cam.lookAt(lookTarget.current)
    if (rig.roll !== 0) cam.rotateZ(rig.roll * DEG)
  })

  if (!curve) return null

  return (
    <PerspectiveCamera
      ref={camRef}
      makeDefault={playMode || cameraView}
      fov={fov}
      near={0.05}
      far={200}
      onPointerDown={(e) => {
        e.stopPropagation()
        useEditorStore.getState().select('cinema-camera')
      }}
    >
      {/* camera body gizmo, rendered in camera space; hidden while looking through */}
      <group ref={bodyRef} visible={!playMode && !cameraView && !tech}>
        <mesh position={[0, 0, 0.09]}>
          <boxGeometry args={[0.16, 0.12, 0.18]} />
          <meshBasicMaterial color={selected ? '#ffffff' : ACCENT} />
        </mesh>
        <mesh position={[0, 0, -0.07]} rotation-x={-Math.PI / 2}>
          <coneGeometry args={[0.07, 0.12, 16, 1, true]} />
          <meshBasicMaterial color={selected ? '#ffffff' : ACCENT} wireframe />
        </mesh>
      </group>
    </PerspectiveCamera>
  )
}
