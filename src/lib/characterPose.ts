import * as THREE from 'three'
import { applyDummyBonePose, DUMMY_POSE_BONES, dummyRestPose, findDummyBone, primeBindPose, type DummyBoneName } from './dummyCharacter'
import { useSceneStore, type SceneObject, type Vec3 } from '../state/useSceneStore'

export interface PoseControl { id: string; label: string; axis: 0 | 1 | 2; sign: number; min: number; max: number }
const control = (id: string, label: string, axis: 0 | 1 | 2, sign = 1, min = -90, max = 90): PoseControl => ({ id, label, axis, sign, min, max })

/** Quaternius v1 anatomical directions in the character's neutral frame (+Z forward). */
export function characterControls(bone: DummyBoneName): PoseControl[] {
  const side = bone.startsWith('Right') ? -1 : 1
  if (bone.endsWith('Forearm')) return [control('bend', 'Bend', 1, -side, 0, 145), control('twist', 'Twist', 0, side)]
  if (bone.endsWith('Arm')) return [control('raise', 'Raise', 2, side, -90, 90), control('forward', 'Forward', 1, -side), control('twist', 'Twist', 0, side)]
  if (bone.endsWith('Shin')) return [control('bend', 'Bend', 0, 1, 0, 145)]
  if (bone.endsWith('Leg')) return [control('raise', 'Raise', 0, -1, -45, 120), control('out', 'Outward', 2, side, -30, 60), control('twist', 'Twist', 1, side)]
  return [control('bend', 'Bend', 0), control('turn', 'Turn', 1), control('tilt', 'Tilt', 2)]
}

function controlOrder(bone: DummyBoneName): THREE.EulerOrder {
  return bone.endsWith('Forearm') ? 'YXZ' : bone.endsWith('Arm') ? 'ZXY' : 'XYZ'
}

const frames = new WeakMap<THREE.Object3D, Map<DummyBoneName, THREE.Quaternion>>()
function neutralFrames(root: THREE.Object3D) {
  const cached = frames.get(root)
  if (cached) return cached
  primeBindPose(root)
  const result = new Map<DummyBoneName, THREE.Quaternion>()
  for (const name of DUMMY_POSE_BONES) {
    const bone = findDummyBone(root, name)
    if (!bone) continue
    const chain: THREE.Object3D[] = []
    for (let node = bone.parent; node && node !== root; node = node.parent) chain.unshift(node)
    const rotation = new THREE.Quaternion()
    for (const node of chain) rotation.multiply(node.userData.dummyBindQuat instanceof THREE.Quaternion ? node.userData.dummyBindQuat : node.quaternion)
    result.set(name, rotation.normalize())
  }
  frames.set(root, result)
  return result
}

function anatomicalRotation(object: SceneObject, bone: DummyBoneName) {
  const parent = neutralFrames(object.root).get(bone) ?? new THREE.Quaternion()
  const angles = object.bonePose?.[bone] ?? dummyRestPose(object.root)[bone]
  const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(...angles.map((v) => THREE.MathUtils.degToRad(v)) as Vec3, 'XYZ'))
  return parent.clone().multiply(delta).multiply(parent.clone().invert())
}

function legacyAngles(object: SceneObject, bone: DummyBoneName, rotation: THREE.Quaternion): Vec3 {
  const parent = neutralFrames(object.root).get(bone) ?? new THREE.Quaternion()
  const local = parent.clone().invert().multiply(rotation).multiply(parent)
  const angles = new THREE.Euler().setFromQuaternion(local.normalize(), 'XYZ')
  return [angles.x, angles.y, angles.z].map(THREE.MathUtils.radToDeg) as Vec3
}

export function characterControlValue(object: SceneObject, bone: DummyBoneName, input: PoseControl): number {
  const angles = new THREE.Euler().setFromQuaternion(anatomicalRotation(object, bone), controlOrder(bone))
  return THREE.MathUtils.radToDeg([angles.x, angles.y, angles.z][input.axis]) * input.sign
}

export function setCharacterControl(objectId: string, bone: DummyBoneName, id: string, value: number) {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  const input = characterControls(bone).find((item) => item.id === id)
  if (!object || object.rigKind !== 'dummy' || !object.root.userData.dummyGltf || !input || !Number.isFinite(value)) return
  const angles = new THREE.Euler().setFromQuaternion(anatomicalRotation(object, bone), controlOrder(bone))
  const values: Vec3 = [angles.x, angles.y, angles.z]
  values[input.axis] = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(value, input.min, input.max) * input.sign)
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...values, controlOrder(bone)))
  const bonePose = { ...object.bonePose, [bone]: legacyAngles(object, bone, rotation) }
  applyDummyBonePose(object.root, bonePose, object.boneTranslate)
  useSceneStore.getState().setDummyFk(objectId, { bonePose, playClips: false })
}

export function mirrorCharacterPose(objectId: string) {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object || object.rigKind !== 'dummy' || !object.root.userData.dummyGltf) return
  const bonePose = { ...object.bonePose }
  for (const bone of DUMMY_POSE_BONES) {
    const source = bone.replace(/^Left/, '_Right').replace(/^Right/, 'Left').replace(/^_Right/, 'Right') as DummyBoneName
    const q = anatomicalRotation(object, source)
    bonePose[bone] = legacyAngles(object, bone, new THREE.Quaternion(q.x, -q.y, -q.z, q.w))
  }
  applyDummyBonePose(object.root, bonePose, object.boneTranslate)
  useSceneStore.getState().setDummyFk(objectId, { bonePose, playClips: false })
}

export function resetCharacterJoints(objectId: string, bones: readonly DummyBoneName[]) {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object || object.rigKind !== 'dummy') return
  const bonePose = { ...object.bonePose }
  const boneTranslate = { ...object.boneTranslate }
  for (const bone of bones) { delete bonePose[bone]; delete boneTranslate[bone] }
  applyDummyBonePose(object.root, bonePose, boneTranslate)
  useSceneStore.getState().setDummyFk(objectId, { bonePose, boneTranslate, playClips: false })
}
