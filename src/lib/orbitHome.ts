import * as THREE from 'three'

/** Fallback offset when the camera sits on its orbit target. Matches EditorCamera. */
const FALLBACK_OFFSET = new THREE.Vector3(5, 3.5, 5.5)

/**
 * Keep the current view direction and distance, but aim the orbit at the world
 * origin so the viewport centre is (0, 0, 0).
 */
export function aimOrbitAtWorldOrigin(
  cameraPosition: THREE.Vector3,
  target: THREE.Vector3,
): void {
  const offset = cameraPosition.clone().sub(target)
  if (offset.lengthSq() < 1e-10) offset.copy(FALLBACK_OFFSET)
  target.set(0, 0, 0)
  cameraPosition.copy(target).add(offset)
}
