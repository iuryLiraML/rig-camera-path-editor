import { beforeEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { ensureDummyTemplateFromBuffer, makeDummyObject, findDummyBone, applyDummyBonePose } from './dummyCharacter'
import { setCharacterControl, characterControlValue, characterControls, mirrorCharacterPose, resetCharacterJoints } from './characterPose'
import { useSceneStore } from '../state/useSceneStore'

beforeEach(() => useSceneStore.setState({ objects: [] }))

it.each(['female', 'male'] as const)('bends the %s elbow forward without changing skin binding or limb length', async (sex) => {
  const bytes = readFileSync(`public/dummy/${sex === 'female' ? 'Female' : 'Male'}.glb`)
  await ensureDummyTemplateFromBuffer(sex, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  const object = makeDummyObject({ figureSex: sex })
  useSceneStore.getState().addObject(object)
  applyDummyBonePose(object.root)
  const hand = findDummyBone(object.root, 'LeftHand')!
  const elbow = findDummyBone(object.root, 'LeftForearm')!
  const before = hand.getWorldPosition(new THREE.Vector3())
  const length = before.distanceTo(elbow.getWorldPosition(new THREE.Vector3()))
  const bindPosition = elbow.position.clone()
  setCharacterControl(object.id, 'LeftForearm', 'bend', 90)
  const after = hand.getWorldPosition(new THREE.Vector3())
  expect(after.z - before.z).toBeGreaterThan(0.15)
  expect(after.distanceTo(elbow.getWorldPosition(new THREE.Vector3()))).toBeCloseTo(length, 5)
  expect(elbow.position.distanceTo(bindPosition)).toBeLessThan(1e-8)
  expect(elbow.quaternion.length()).toBeCloseTo(1, 6)
})

it('keeps a 135 degree elbow bend editable without wrapping to 45 degrees', async () => {
  const object = makeDummyObject({ figureSex: 'male' })
  useSceneStore.getState().addObject(object)
  setCharacterControl(object.id, 'RightForearm', 'bend', 135)
  const posed = useSceneStore.getState().objects[0]
  expect(characterControlValue(posed, 'RightForearm', characterControls('RightForearm')[0])).toBeCloseTo(135, 4)
})

it('mirrors across the character midline and double mirror restores the hand position', () => {
  const object = makeDummyObject({ figureSex: 'male' })
  useSceneStore.getState().addObject(object)
  setCharacterControl(object.id, 'LeftForearm', 'bend', 90)
  const original = findDummyBone(object.root, 'LeftHand')!.getWorldPosition(new THREE.Vector3())
  mirrorCharacterPose(object.id)
  const reflected = findDummyBone(object.root, 'RightHand')!.getWorldPosition(new THREE.Vector3())
  expect(reflected.x).toBeCloseTo(-original.x, 4)
  expect(reflected.y).toBeCloseTo(original.y, 4)
  expect(reflected.z).toBeCloseTo(original.z, 4)
  mirrorCharacterPose(object.id)
  expect(findDummyBone(object.root, 'LeftHand')!.getWorldPosition(new THREE.Vector3()).distanceTo(original)).toBeLessThan(1e-5)
})

it('duplicates a posed Figure without changing its bind pose or sharing joints', () => {
  const object = makeDummyObject({ figureSex: 'male' })
  useSceneStore.getState().addObject(object)
  setCharacterControl(object.id, 'LeftForearm', 'bend', 90)
  const original = findDummyBone(object.root, 'LeftHand')!.getWorldPosition(new THREE.Vector3())
  useSceneStore.getState().duplicateObject(object.id)
  const copy = useSceneStore.getState().objects[1]
  applyDummyBonePose(copy.root, copy.bonePose, copy.boneTranslate)
  expect(findDummyBone(copy.root, 'LeftHand')!.getWorldPosition(new THREE.Vector3()).distanceTo(original)).toBeLessThan(1e-5)
  setCharacterControl(copy.id, 'LeftForearm', 'bend', 45)
  expect(findDummyBone(object.root, 'LeftHand')!.getWorldPosition(new THREE.Vector3()).distanceTo(original)).toBeLessThan(1e-5)
})

it('resets explicitly selected joint translations while retaining other legacy translations', () => {
  const object = makeDummyObject({ figureSex: 'male', boneTranslate: { LeftForearm: [0.2, 0.3, 0.4], RightForearm: [0.5, 0.6, 0.7] } })
  useSceneStore.getState().addObject(object)
  resetCharacterJoints(object.id, ['LeftForearm'])
  const current = useSceneStore.getState().objects[0]
  expect(current.boneTranslate?.LeftForearm).toBeUndefined()
  expect(current.boneTranslate?.RightForearm).toEqual([0.5, 0.6, 0.7])
})
