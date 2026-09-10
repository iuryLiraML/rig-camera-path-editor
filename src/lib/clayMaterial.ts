/**
 * The one clay material the whole app uses for untextured geometry. Extracted
 * so the thumbnail renderer, the 3D preview, and the scene insertion share a
 * single definition instead of re-declaring the same literal.
 */
import * as THREE from 'three'

export function clayMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setScalar(0.82),
    roughness: 0.88,
    metalness: 0,
  })
}

export function clayFloorMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setScalar(0.6),
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  })
}
