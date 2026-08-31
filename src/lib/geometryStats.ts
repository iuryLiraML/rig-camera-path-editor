import * as THREE from 'three'

/** Counts the triangle draw cost represented by every mesh instance in a loaded root. */
export function countRenderedTriangles(root: THREE.Object3D): number {
  let total = 0
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const geometry = child.geometry as THREE.BufferGeometry
    total += (geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3
  })
  return Math.round(total)
}
