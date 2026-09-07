import * as THREE from 'three'
import { useSceneStore, type SceneObject } from '../state/useSceneStore'
import { useRigStore } from '../state/useRigStore'
import { usePathStore } from '../state/usePathStore'
import { evalObjectWorldTransform } from './objectMotion'
import type { CadOp } from './primitiveGeometry'

export function primitiveMesh(object: SceneObject): THREE.Mesh {
  if (!object.primitive || object.rigKind === 'dummy') throw new Error('Select an existing primitive solid.')
  const mesh = object.root.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh)
  if (!mesh) throw new Error('The primitive mesh is missing.')
  return mesh
}

function solidMatrix(object: SceneObject) {
  const rig = useRigStore.getState()
  const path = usePathStore.getState().paths.find((p) => p.id === object.follow?.pathId)
  const pose = evalObjectWorldTransform(rig.t, object, path, rig.ease)
  const rotation = new THREE.Euler(...pose.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
  return new THREE.Matrix4().compose(new THREE.Vector3(...pose.position), new THREE.Quaternion().setFromEuler(rotation), new THREE.Vector3(...pose.scale))
    .multiply(new THREE.Matrix4().makeTranslation(0, primitiveMesh(object).position.y, 0))
}

/** Snapshot the operand at the current playhead in the target seed's local space. */
export function booleanPrimitive(targetId: string, operandId: string, mode: 'union' | 'subtract' | 'intersect') {
  const scene = useSceneStore.getState()
  const target = scene.objects.find((o) => o.id === targetId)
  const operand = scene.objects.find((o) => o.id === operandId)
  if (!target || !operand || targetId === operandId) throw new Error('Choose two different primitive solids.')
  primitiveMesh(target); primitiveMesh(operand)
  const targetMatrix = solidMatrix(target)
  if (Math.abs(targetMatrix.determinant()) < 1e-10) throw new Error('The target scale must not be zero.')
  const op: CadOp = { type: 'boolean', mode, operand: structuredClone(operand.primitive!), matrix: targetMatrix.invert().multiply(solidMatrix(operand)).toArray() }
  scene.appendPrimitiveOp(targetId, op)
}

export function solidEditNotice(edit: () => void) {
  try { edit() } catch (error) { useSceneStore.getState().showNotice(error instanceof Error ? error.message : 'The solid could not be edited.') }
}
