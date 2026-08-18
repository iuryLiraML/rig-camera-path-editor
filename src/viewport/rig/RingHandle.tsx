import { useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useScreenScale } from '../../lib/screenScale'

export const RIG_ORANGE = '#f5a623'
export const RIG_ORANGE_HOT = '#ffd08a'

/** Same family as path anchors (0.10) and the look-at sphere (0.09). */
export const RING_SCREEN_SCALE = 0.12

export type RingHandleKind = 'ground' | 'target'

const PICK = new THREE.CircleGeometry(1, 24)
const PAD = new THREE.CircleGeometry(0.5, 24)
const CROSS = new THREE.BoxGeometry(1.1, 0.08, 0.08)
const DIAMOND = new THREE.PlaneGeometry(0.65, 0.65)
const ARROW = new THREE.ConeGeometry(0.09, 0.22, 7)
const FLOOR_EULER = new THREE.Euler(-Math.PI / 2, 0, 0)

const ARROW_R = 0.78
const ANGLES = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2] as const

function arrowRotation(angle: number): [number, number, number] {
  return [0, 0, angle + Math.PI / 2]
}

function Glyph({ kind, color }: { kind: RingHandleKind; color: string }) {
  switch (kind) {
    case 'ground':
      return (
        <>
          <mesh geometry={PAD}>
            <meshBasicMaterial color={color} depthTest={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh geometry={CROSS}>
            <meshBasicMaterial color={color} depthTest={false} />
          </mesh>
          <mesh geometry={CROSS} rotation={[0, 0, Math.PI / 2]}>
            <meshBasicMaterial color={color} depthTest={false} />
          </mesh>
        </>
      )
    case 'target':
      return (
        <>
          <mesh geometry={DIAMOND} rotation={[0, 0, Math.PI / 4]}>
            <meshBasicMaterial color={color} depthTest={false} side={THREE.DoubleSide} />
          </mesh>
          {ANGLES.map((angle) => (
            <mesh
              key={angle}
              geometry={ARROW}
              position={[Math.cos(angle) * ARROW_R, Math.sin(angle) * ARROW_R, 0]}
              rotation={arrowRotation(angle)}
            >
              <meshBasicMaterial color={color} depthTest={false} />
            </mesh>
          ))}
        </>
      )
    default: {
      const _never: never = kind
      return _never
    }
  }
}

/**
 * Small anchor-sized orange handle. Ground = floor pad + cross (XZ truck),
 * target = diamond + inward arrows (aim). The camera body itself is the
 * frustum icon in CinemaCamera — selecting it brings up the move/rotate gizmo.
 */
export function RingHandle({
  kind,
  billboard,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  kind: RingHandleKind
  billboard: boolean
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void
  onPointerUp: (e: ThreeEvent<PointerEvent>) => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const [hot, setHot] = useState(false)
  useScreenScale(groupRef, RING_SCREEN_SCALE)

  useFrame(({ camera }) => {
    const g = groupRef.current
    if (!g) return
    if (billboard) g.quaternion.copy(camera.quaternion)
    else g.quaternion.setFromEuler(FLOOR_EULER)
  })

  const color = hot ? RIG_ORANGE_HOT : RIG_ORANGE

  return (
    <group
      ref={groupRef}
      userData={{ pickKind: kind === 'target' ? 'target' : 'camera', pickId: `rig:${kind}` }}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHot(true)
      }}
      onPointerOut={() => setHot(false)}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        onPointerDown(e)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <mesh geometry={PICK}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <Glyph kind={kind} color={color} />
    </group>
  )
}
