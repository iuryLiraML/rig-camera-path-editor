import * as THREE from 'three'

function isHelper(child: THREE.Object3D): boolean {
  return (
    child instanceof THREE.Camera ||
    child instanceof THREE.Light ||
    child instanceof THREE.Line ||
    child instanceof THREE.LineSegments ||
    child instanceof THREE.LineLoop ||
    child instanceof THREE.Points ||
    child instanceof THREE.Sprite
  )
}

/** World AABB of real meshes only — cameras/keypoints must not drive scale. */
export function meshWorldBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  root.updateWorldMatrix(true, true)
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) return
    if (child instanceof THREE.SkinnedMesh) {
      child.computeBoundingBox()
      const posed = child.boundingBox
      if (posed && !posed.isEmpty()) {
        box.union(posed.clone().applyMatrix4(child.matrixWorld))
      }
      return
    }
    const geometry = child.geometry
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    const local = geometry.boundingBox
    if (!local || local.isEmpty()) return
    box.union(local.clone().applyMatrix4(child.matrixWorld))
  })
  return box
}

export function boundsAreUsable(box: THREE.Box3): boolean {
  if (box.isEmpty()) return false
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  return Number.isFinite(maxDim) && maxDim > 1e-8
}

/**
 * SAM 3D Body GLBs often ship without normals (clay then shades as a flat
 * slab) and with cameras / keypoint clouds that wreck the import scale.
 */
export function prepareImportedRoot(root: THREE.Object3D): THREE.Object3D {
  const drop: THREE.Object3D[] = []
  root.traverse((child) => {
    if (child !== root && isHelper(child)) drop.push(child)
  })
  for (const child of drop) child.parent?.remove(child)

  repairImportedShading(root)
  root.updateMatrixWorld(true)
  return root
}

/** Already-imported SAM meshes often have missing or zero normals. */
export function repairImportedShading(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry?.attributes.position) return
    if (normalsAreDegenerate(child.geometry)) {
      child.geometry.computeVertexNormals()
    }
    child.geometry.computeBoundingBox()
    child.geometry.computeBoundingSphere()
    child.castShadow = true
    child.receiveShadow = true
    child.raycast = THREE.Mesh.prototype.raycast
    if (child instanceof THREE.SkinnedMesh) {
      child.frustumCulled = false
      child.skeleton?.pose()
      child.updateMatrixWorld(true)
      child.computeBoundingBox()
    }
  })
}

function normalsAreDegenerate(geometry: THREE.BufferGeometry): boolean {
  const normals = geometry.attributes.normal
  if (!normals || normals.count === 0) return true
  for (let i = 0; i < normals.count; i++) {
    const x = normals.getX(i)
    const y = normals.getY(i)
    const z = normals.getZ(i)
    if (x * x + y * y + z * z > 1e-8) return false
  }
  return true
}
