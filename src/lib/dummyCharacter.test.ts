import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  addDummyToScene,
  applyDummyBonePose,
  applyDummyBoneWorldTransform,
  dummyBoneFromHit,
  DUMMY_BONE_ALIASES,
  DUMMY_GLB_URLS,
  DUMMY_POSE_BONES,
  ensureDummyTemplateFromBuffer,
  listDummyPoseBones,
  primeBindPose,
  readDummyBonePose,
  readDummyBoneTranslate,
  remapDummyClipsToGltf,
  resetDummyTemplatesForTests,
  setDummyBoneAxis,
} from './dummyCharacter'
import { toMeta } from './sceneIO'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'

afterEach(() => {
  useSceneStore.setState({ objects: [] })
  useEditorStore.setState({ selection: null })
})

describe('addDummyToScene', () => {
  it('adds a grayscale dummy with Idle Walk Run and does not select as a Gaussian', () => {
    const id = addDummyToScene()
    const object = useSceneStore.getState().objects.find((item) => item.id === id)
    expect(object?.rigKind).toBe('dummy')
    expect(object?.figureSex).toBe('male')
    expect(object?.playClips).toBe(false)
    expect(object?.clips.map((clip) => clip.name)).toEqual(['Idle', 'Walk', 'Run'])
    const walk = object?.clips.find((clip) => clip.name === 'Walk')
    expect(walk?.tracks.some((track) => track.name.includes('LeftLeg'))).toBe(true)
    expect(walk?.tracks.some((track) => track.name.includes('RightLeg'))).toBe(true)
    expect(useEditorStore.getState().selection).toBe(`obj:${id}`)
    expect(object?.root.getObjectByName('LeftArm')).toBeInstanceOf(THREE.Bone)
    expect(object?.root.getObjectByName('LeftArmMesh')?.userData.dummyBone).toBe('LeftArm')
  })

  it('names a female figure Female', () => {
    const id = addDummyToScene('female')
    const object = useSceneStore.getState().objects.find((item) => item.id === id)
    expect(object?.name).toBe('Female')
    expect(object?.figureSex).toBe('female')
  })

  it('applies a manual joint pose when clips are off', () => {
    const id = addDummyToScene()
    setDummyBoneAxis(id, 'LeftArm', 2, 40)
    const object = useSceneStore.getState().objects.find((item) => item.id === id)
    expect(object?.playClips).toBe(false)
    expect(object?.bonePose?.LeftArm?.[2]).toBe(40)
    const bone = object?.root.getObjectByName('LeftArm')
    expect(bone).toBeInstanceOf(THREE.Bone)
    expect((bone as THREE.Bone).rotation.z).toBeCloseTo((40 * Math.PI) / 180, 5)
  })

  it('picks the nearest pose bone to a world hit on a skinned mesh', () => {
    const id = addDummyToScene()
    const object = useSceneStore.getState().objects.find((item) => item.id === id)
    const arm = object?.root.getObjectByName('LeftArm') as THREE.Bone
    object!.root.updateWorldMatrix(true, true)
    const point = new THREE.Vector3()
    arm.getWorldPosition(point)
    expect(dummyBoneFromHit(object!.root, point)).toBe('LeftArm')
  })

  it('composes pose as a quaternion delta and does not move bind position', () => {
    const id = addDummyToScene()
    const object = useSceneStore.getState().objects.find((item) => item.id === id)!
    primeBindPose(object.root)
    const arm = object.root.getObjectByName('LeftArm') as THREE.Bone
    const bindPos = arm.position.clone()
    applyDummyBonePose(object.root, { ...object.bonePose, LeftArm: [0, 0, 40] })
    expect(arm.position.distanceTo(bindPos)).toBeLessThan(1e-8)
    const read = readDummyBonePose(object.root)
    expect(read.LeftArm[2]).toBeCloseTo(40, 4)
  })

  it('restores bind position unless a stored translate is applied', () => {
    const id = addDummyToScene()
    const object = useSceneStore.getState().objects.find((item) => item.id === id)!
    const arm = object.root.getObjectByName('LeftArm') as THREE.Bone
    const bindPos = (arm.userData.dummyBindPos as THREE.Vector3).clone()
    arm.position.x += 0.2
    applyDummyBonePose(object.root, object.bonePose)
    expect(arm.position.distanceTo(bindPos)).toBeLessThan(1e-8)
    applyDummyBonePose(object.root, object.bonePose, { LeftArm: [bindPos.x + 0.15, bindPos.y, bindPos.z] })
    expect(arm.position.x).toBeCloseTo(bindPos.x + 0.15, 5)
  })

  it('reads a gizmo translate as a persisted local position', () => {
    const id = addDummyToScene()
    const object = useSceneStore.getState().objects.find((item) => item.id === id)!
    const arm = object.root.getObjectByName('LeftArm') as THREE.Bone
    object.root.updateWorldMatrix(true, true)
    const worldPos = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    arm.getWorldPosition(worldPos)
    arm.getWorldQuaternion(worldQuat)
    worldPos.x += 0.2
    applyDummyBoneWorldTransform(arm, worldPos, worldQuat, 'translate')
    const translate = readDummyBoneTranslate(object.root)
    expect(translate.LeftArm).toBeDefined()
    expect(translate.LeftArm[0]).not.toBeCloseTo((arm.userData.dummyBindPos as THREE.Vector3).x, 3)
  })

  it('lists only bones that exist on the capsule fallback', () => {
    const id = addDummyToScene()
    const object = useSceneStore.getState().objects.find((item) => item.id === id)!
    expect(listDummyPoseBones(object.root)).toEqual(['Hips', 'Chest', 'Head', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'])
  })

  it('maps a world proxy rotate without moving bind position or scale', () => {
    const id = addDummyToScene()
    const object = useSceneStore.getState().objects.find((item) => item.id === id)!
    const arm = object.root.getObjectByName('LeftArm') as THREE.Bone
    object.root.updateWorldMatrix(true, true)
    const bindPos = arm.position.clone()
    const worldPos = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    arm.getWorldPosition(worldPos)
    arm.getWorldQuaternion(worldQuat)
    const turned = worldQuat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.4))
    applyDummyBoneWorldTransform(arm, worldPos, turned, 'rotate')
    expect(arm.position.distanceTo(bindPos)).toBeLessThan(1e-8)
    expect(arm.scale.x).toBeCloseTo(1, 5)
  })
})

function readGltfJson(file: string) {
  const buf = readFileSync(file)
  const jsonLen = buf.readUInt32LE(12)
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    animations?: { name: string }[]
    nodes?: { name?: string }[]
    skins?: unknown[]
  }
}

describe('dummy GLB clips', () => {
  it('rebuilds Walk as bind-relative quaternions and pelvis offsets', () => {
    const root = new THREE.Group()
    const pelvis = new THREE.Bone()
    pelvis.name = 'pelvis'
    pelvis.position.set(0, 0.9, 0)
    root.add(pelvis)
    const arm = new THREE.Bone()
    arm.name = 'upperarm_l'
    arm.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3)
    pelvis.add(arm)
    primeBindPose(root)
    const clips = remapDummyClipsToGltf(root)
    const walk = clips.find((clip) => clip.name === 'Walk')
    expect(walk).toBeDefined()
    const quat = walk?.tracks.find((track) => track.name === 'upperarm_l.quaternion')
    expect(quat).toBeInstanceOf(THREE.QuaternionKeyframeTrack)
    expect(walk?.tracks.some((track) => track.name.includes('rotation['))).toBe(false)
    const hips = walk?.tracks.find((track) => track.name === 'pelvis.position')
    expect(hips?.values[0]).toBeCloseTo(0, 5)
    expect(hips?.values[1]).toBeCloseTo(0.9, 5)
    const expected = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0, 0, 0.45))
      .multiply(arm.userData.dummyBindQuat as THREE.Quaternion)
    expect(quat?.values[0]).toBeCloseTo(expected.x, 5)
    expect(quat?.values[1]).toBeCloseTo(expected.y, 5)
    expect(quat?.values[2]).toBeCloseTo(expected.z, 5)
    expect(quat?.values[3]).toBeCloseTo(expected.w, 5)
  })
})

function glbBuffer(file: string) {
  const buf = readFileSync(join(process.cwd(), 'public/dummy', file))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

describe('dummy Superhero GLB', () => {
  afterEach(() => {
    resetDummyTemplatesForTests()
  })

  it('poses Female without moving bind positions of other bones', async () => {
    const loaded = await ensureDummyTemplateFromBuffer('female', glbBuffer('Female.glb'))
    expect(loaded).not.toBeNull()
    const id = addDummyToScene('female')
    const object = useSceneStore.getState().objects.find((item) => item.id === id)!
    expect(object.root.userData.dummyGltf).toBe(true)
    expect(listDummyPoseBones(object.root)).toHaveLength(DUMMY_POSE_BONES.length)
    const arm = object.root.getObjectByName('upperarm_l') as THREE.Bone
    const shin = object.root.getObjectByName('calf_l') as THREE.Bone
    expect(arm).toBeInstanceOf(THREE.Bone)
    const shinBind = (shin.userData.dummyBindPos as THREE.Vector3).clone()
    setDummyBoneAxis(id, 'LeftArm', 2, 40)
    const next = useSceneStore.getState().objects.find((item) => item.id === id)!
    expect(next.playClips).toBe(false)
    expect(readDummyBonePose(next.root).LeftArm[2]).toBeCloseTo(40, 3)
    expect(shin.position.distanceTo(shinBind)).toBeLessThan(1e-8)
    expect(walkUsesBindRelativeTracks(object.clips)).toBe(true)
  })

  it('keeps Male pelvis off the origin on the remapped Idle track', async () => {
    const loaded = await ensureDummyTemplateFromBuffer('male', glbBuffer('Male.glb'))
    expect(loaded).not.toBeNull()
    const id = addDummyToScene('male')
    const object = useSceneStore.getState().objects.find((item) => item.id === id)!
    const pelvis = object.root.getObjectByName('pelvis') as THREE.Bone
    const bind = pelvis.userData.dummyBindPos as THREE.Vector3
    const idle = object.clips.find((clip) => clip.name === 'Idle')
    const hips = idle?.tracks.find((track) => track.name === 'pelvis.position')
    expect(hips).toBeDefined()
    expect(hips!.values[0]).toBeCloseTo(bind.x, 5)
    expect(hips!.values[1]).toBeCloseTo(bind.y, 5)
    expect(hips!.values[4]).toBeCloseTo(bind.y + 0.02, 5)
  })

  it('writes figureSex and boneTranslate into scene meta', async () => {
    await ensureDummyTemplateFromBuffer('female', glbBuffer('Female.glb'))
    const id = addDummyToScene('female')
    useSceneStore.getState().setDummyFk(id, {
      bonePose: { LeftArm: [0, 0, 40] },
      boneTranslate: { LeftArm: [0.2, 1.1, 0] },
    })
    const object = useSceneStore.getState().objects.find((item) => item.id === id)!
    expect(toMeta(object)).toMatchObject({
      rigKind: 'dummy',
      figureSex: 'female',
      bonePose: { LeftArm: [0, 0, 40] },
      boneTranslate: { LeftArm: [0.2, 1.1, 0] },
    })
  })
})

function walkUsesBindRelativeTracks(clips: THREE.AnimationClip[]) {
  const walk = clips.find((clip) => clip.name === 'Walk')
  if (!walk) return false
  const hasEuler = walk.tracks.some((track) => track.name.includes('rotation['))
  const hasQuat = walk.tracks.some((track) => track.name.endsWith('.quaternion'))
  return !hasEuler && hasQuat
}

describe('dummy vendor', () => {
  it('records public-origin-safe Female and Male paths and UE pose aliases', () => {
    expect(DUMMY_GLB_URLS).toEqual({
      female: '/dummy/Female.glb',
      male: '/dummy/Male.glb',
    })
    expect(DUMMY_BONE_ALIASES.Hips).toBe('pelvis')
    expect(DUMMY_BONE_ALIASES.LeftArm).toBe('upperarm_l')
    expect(DUMMY_BONE_ALIASES.LeftForearm).toBe('lowerarm_l')
    expect(DUMMY_BONE_ALIASES.LeftFoot).toBe('foot_l')
  })

  it('vendors skinned Female and Male GLBs with the shared pelvis rig', () => {
    for (const file of ['Female.glb', 'Male.glb'] as const) {
      const json = readGltfJson(join(process.cwd(), 'public/dummy', file))
      expect(json.skins?.length).toBeGreaterThan(0)
      const names = (json.nodes ?? []).map((node) => node.name)
      expect(names).toEqual(
        expect.arrayContaining([
          'pelvis',
          'spine_01',
          'spine_03',
          'Head',
          'upperarm_l',
          'upperarm_r',
          'thigh_l',
          'thigh_r',
        ]),
      )
    }
  })
})
