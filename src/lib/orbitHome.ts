import * as THREE from 'three'

/** Same 100% zoom distance as the editor camera's default framing. */
export const DEFAULT_HOME_DIST = 7.9

/** Fallback offset when the camera sits on its orbit target. Matches EditorCamera. */
const FALLBACK_OFFSET = new THREE.Vector3(5, 3.5, 5.5)

/**
 * Aim the orbit at the world origin, keeping the current view direction, at the
 * default home distance so a tight zoom cannot land inside the scene.
 */
export function aimOrbitAtWorldOrigin(
  cameraPosition: THREE.Vector3,
  target: THREE.Vector3,
  distance = DEFAULT_HOME_DIST,
): void {
  const offset = cameraPosition.clone().sub(target)
  if (offset.lengthSq() < 1e-10) offset.copy(FALLBACK_OFFSET)
  offset.setLength(distance)
  target.set(0, 0, 0)
  cameraPosition.copy(target).add(offset)
}
