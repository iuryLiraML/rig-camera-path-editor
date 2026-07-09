import { useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

const worldPos = new THREE.Vector3()

/**
 * Keeps a gizmo at a constant apparent size on screen: `size` is the desired
 * world size when 7 units away from a perspective camera (or at ortho zoom 110).
 */
export function useScreenScale(ref: RefObject<THREE.Object3D | null>, size: number) {
  const last = useRef(0)
  useFrame(({ camera }) => {
    const obj = ref.current
    if (!obj) return
    let s: number
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      s = (size * 110) / (camera as THREE.OrthographicCamera).zoom
    } else {
      const dist = obj.getWorldPosition(worldPos).distanceTo(camera.position)
      s = (size * dist) / 7
    }
    // near the camera the true constant-screen-size scale gets tiny — a high
    // floor here made gizmos balloon on approach, so keep it barely above zero
    s = Math.min(size * 5, Math.max(size * 0.02, s))
    if (Math.abs(s - last.current) > 1e-5) {
      obj.scale.setScalar(s)
      last.current = s
    }
  })
}
