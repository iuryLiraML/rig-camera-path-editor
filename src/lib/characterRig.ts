import * as THREE from 'three'

export interface CharacterRigInspection {
  skinned: boolean
  joints: number
  issue?: string
}

const inspections = new WeakMap<THREE.Object3D, CharacterRigInspection>()

/** Inspect once per parsed asset revision, never during animation evaluation. */
export function inspectCharacterRig(root: THREE.Object3D): CharacterRigInspection {
  const cached = inspections.get(root)
  if (cached) return cached
  const nodes = new Set<THREE.Object3D>()
  const skins: THREE.SkinnedMesh[] = []
  root.traverse((node) => { nodes.add(node); if (node instanceof THREE.SkinnedMesh) skins.push(node) })
  let issue: string | undefined
  const joints = new Set<THREE.Bone>()
  for (const mesh of skins) {
    const skeleton = mesh.skeleton
    const positions = mesh.geometry.getAttribute('position')
    const indices = mesh.geometry.getAttribute('skinIndex')
    const weights = mesh.geometry.getAttribute('skinWeight')
    if (!skeleton?.bones.length || !positions || !indices || !weights || indices.count !== positions.count || weights.count !== positions.count || indices.itemSize !== 4 || weights.itemSize !== 4) {
      issue = 'The mesh has incomplete skinning data.'; break
    }
    if (skeleton.boneInverses.length !== skeleton.bones.length || [mesh.bindMatrix, mesh.bindMatrixInverse, ...skeleton.boneInverses].some((matrix) => !matrix.elements.every(Number.isFinite) || Math.abs(matrix.determinant()) < 1e-12)) {
      issue = 'The rig has invalid bind transforms.'; break
    }
    for (const bone of skeleton.bones) {
      joints.add(bone)
      if (!nodes.has(bone) || !bone.isBone || ![...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.scale.toArray()].every(Number.isFinite)) issue = 'The rig has missing or invalid joints.'
    }
    if (issue) break
    for (let vertex = 0; vertex < positions.count; vertex++) {
      let total = 0
      for (let slot = 0; slot < 4; slot++) {
        const index = indices.getComponent(vertex, slot)
        const weight = weights.getComponent(vertex, slot)
        if (!Number.isInteger(index) || index < 0 || index >= skeleton.bones.length || !Number.isFinite(weight) || weight < 0) issue = 'The mesh has invalid joint weights.'
        total += weight
      }
      if (Math.abs(total - 1) > 0.01) issue = 'The mesh has unnormalized joint weights.'
      if (issue) break
    }
    if (issue) break
  }
  const result = { skinned: skins.length > 0 && !issue, joints: joints.size, issue }
  inspections.set(root, result)
  return result
}
