import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { boundsAreUsable, meshWorldBounds, prepareImportedRoot } from './prepareImport'
import { makeObject, useSceneStore, type SceneObject, type Vec3 } from '../state/useSceneStore'
import { useEditorStore } from '../state/useEditorStore'
import type { AssetDisplayMode } from './assetDisplay'

export type FigureSex = 'female' | 'male'

/** Public-origin-safe Quaternius Superhero pair (CC0). See public/dummy/VENDOR.md. */
export const DUMMY_GLB_URLS: Record<FigureSex, string> = {
  female: '/dummy/Female.glb',
  male: '/dummy/Male.glb',
}

/** Poseable bones. Names stay stable so Idle/Walk/Run tracks and saved poses match. */
export const DUMMY_POSE_BONES = [
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'LeftClavicle',
  'RightClavicle',
  'LeftArm',
  'RightArm',
  'LeftForearm',
  'RightForearm',
  'LeftHand',
  'RightHand',
  'LeftLeg',
  'RightLeg',
  'LeftShin',
  'RightShin',
  'LeftFoot',
  'RightFoot',
] as const

export type DummyBoneName = (typeof DUMMY_POSE_BONES)[number]

/**
 * UE / Quaternius joints → pose UI. These names survive GLTFLoader
 * (underscores, no dots).
 */
export const DUMMY_BONE_ALIASES: Record<DummyBoneName, string> = {
  Hips: 'pelvis',
  Spine: 'spine_01',
  Chest: 'spine_03',
  Neck: 'neck_01',
  Head: 'Head',
  LeftClavicle: 'clavicle_l',
  RightClavicle: 'clavicle_r',
  LeftArm: 'upperarm_l',
  RightArm: 'upperarm_r',
  LeftForearm: 'lowerarm_l',
  RightForearm: 'lowerarm_r',
  LeftHand: 'hand_l',
  RightHand: 'hand_r',
  LeftLeg: 'thigh_l',
  RightLeg: 'thigh_r',
  LeftShin: 'calf_l',
  RightShin: 'calf_r',
  LeftFoot: 'foot_l',
  RightFoot: 'foot_r',
}

const DUMMY_GLB_TO_POSE: Record<string, DummyBoneName> = Object.fromEntries(
  (Object.entries(DUMMY_BONE_ALIASES) as [DummyBoneName, string][]).map(([pose, glb]) => [glb, pose]),
)

export const DUMMY_BONE_LABELS: Record<DummyBoneName, string> = {
  Hips: 'Hips',
  Spine: 'Spine',
  Chest: 'Chest',
  Neck: 'Neck',
  Head: 'Head',
  LeftClavicle: 'Left clavicle',
  RightClavicle: 'Right clavicle',
  LeftArm: 'Left arm',
  RightArm: 'Right arm',
  LeftForearm: 'Left forearm',
  RightForearm: 'Right forearm',
  LeftHand: 'Left hand',
  RightHand: 'Right hand',
  LeftLeg: 'Left leg',
  RightLeg: 'Right leg',
  LeftShin: 'Left shin',
  RightShin: 'Right shin',
  LeftFoot: 'Left foot',
  RightFoot: 'Right foot',
}

/** Rest euler in degrees — capsule bind has arms slightly out. GLB bind is zero. */
export const DUMMY_REST_POSE: Record<DummyBoneName, Vec3> = {
  Hips: [0, 0, 0],
  Spine: [0, 0, 0],
  Chest: [0, 0, 0],
  Neck: [0, 0, 0],
  Head: [0, 0, 0],
  LeftClavicle: [0, 0, 0],
  RightClavicle: [0, 0, 0],
  LeftArm: [0, 0, 11.5],
  RightArm: [0, 0, -11.5],
  LeftForearm: [0, 0, 0],
  RightForearm: [0, 0, 0],
  LeftHand: [0, 0, 0],
  RightHand: [0, 0, 0],
  LeftLeg: [0, 0, 0],
  RightLeg: [0, 0, 0],
  LeftShin: [0, 0, 0],
  RightShin: [0, 0, 0],
  LeftFoot: [0, 0, 0],
  RightFoot: [0, 0, 0],
}

const DUMMY_ZERO_POSE: Record<DummyBoneName, Vec3> = Object.fromEntries(
  DUMMY_POSE_BONES.map((name) => [name, [0, 0, 0] as Vec3]),
) as Record<DummyBoneName, Vec3>

const DEG = Math.PI / 180

type DummyGltfTemplate = {
  scene: THREE.Object3D
  clips: THREE.AnimationClip[]
}

const dummyTemplates: Partial<Record<FigureSex, DummyGltfTemplate>> = {}
const dummyTemplatePromises: Partial<Record<FigureSex, Promise<DummyGltfTemplate | null>>> = {}

export function dummyRestPose(root?: THREE.Object3D | null): Record<DummyBoneName, Vec3> {
  return root?.userData.dummyGltf ? DUMMY_ZERO_POSE : DUMMY_REST_POSE
}

function addBone(name: DummyBoneName, parent: THREE.Object3D, position: Vec3) {
  const bone = new THREE.Bone()
  bone.name = name
  bone.position.set(...position)
  parent.add(bone)
  return bone
}

function addLimb(
  name: DummyBoneName,
  parent: THREE.Object3D,
  position: Vec3,
  mesh: THREE.Mesh,
  meshLocal: Vec3,
) {
  const bone = addBone(name, parent, position)
  mesh.name = `${name}Mesh`
  mesh.userData.dummyBone = name
  mesh.position.set(...meshLocal)
  bone.add(mesh)
  return bone
}

function makeDummyRoot(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'Dummy'
  const hips = addBone('Hips', root, [0, 0, 0])
  addLimb('Chest', hips, [0, 0, 0], new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.7, 4, 8)), [0, 0.85, 0])
  addLimb('Head', hips, [0, 0, 0], new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10)), [0, 1.45, 0])
  addLimb(
    'LeftArm',
    hips,
    [-0.28, 1.05, 0],
    new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.55, 4, 8)),
    [0, 0, 0],
  )
  addLimb(
    'RightArm',
    hips,
    [0.28, 1.05, 0],
    new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.55, 4, 8)),
    [0, 0, 0],
  )
  addLimb(
    'LeftLeg',
    hips,
    [-0.12, 0.28, 0],
    new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.55, 4, 8)),
    [0, 0, 0],
  )
  addLimb(
    'RightLeg',
    hips,
    [0.12, 0.28, 0],
    new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.55, 4, 8)),
    [0, 0, 0],
  )
  primeBindPose(root)
  applyDummyBonePose(root, DUMMY_REST_POSE)
  return root
}

function clip(name: string, duration: number, tracks: THREE.KeyframeTrack[]) {
  return new THREE.AnimationClip(name, duration, tracks)
}

function dummyClips(): THREE.AnimationClip[] {
  const idle = clip('Idle', 2, [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 1, 2], [0, 0, 0, 0, 0.02, 0, 0, 0, 0]),
  ])
  const walk = clip('Walk', 1, [
    new THREE.NumberKeyframeTrack('LeftArm.rotation[z]', [0, 0.5, 1], [0.45, -0.15, 0.45]),
    new THREE.NumberKeyframeTrack('RightArm.rotation[z]', [0, 0.5, 1], [-0.45, 0.15, -0.45]),
    new THREE.NumberKeyframeTrack('LeftLeg.rotation[x]', [0, 0.5, 1], [0.4, -0.4, 0.4]),
    new THREE.NumberKeyframeTrack('RightLeg.rotation[x]', [0, 0.5, 1], [-0.4, 0.4, -0.4]),
    new THREE.VectorKeyframeTrack('Hips.position', [0, 0.5, 1], [0, 0, 0, 0, 0.04, 0, 0, 0, 0]),
  ])
  const run = clip('Run', 0.6, [
    new THREE.NumberKeyframeTrack('LeftArm.rotation[z]', [0, 0.3, 0.6], [0.7, -0.35, 0.7]),
    new THREE.NumberKeyframeTrack('RightArm.rotation[z]', [0, 0.3, 0.6], [-0.7, 0.35, -0.7]),
    new THREE.NumberKeyframeTrack('LeftLeg.rotation[x]', [0, 0.3, 0.6], [0.55, -0.55, 0.55]),
    new THREE.NumberKeyframeTrack('RightLeg.rotation[x]', [0, 0.3, 0.6], [-0.55, 0.55, -0.55]),
    new THREE.VectorKeyframeTrack('Hips.position', [0, 0.3, 0.6], [0, 0, 0, 0, 0.06, 0, 0, 0, 0]),
  ])
  return [idle, walk, run]
}

/**
 * Capsule clips write Euler / origin positions. On the Superhero bind those
 * tracks would snap `pelvis` to (0,0,0) and fight the IBM. Rebuild as
 * bind + offset and `q = delta * bind`.
 */
export function remapDummyClipsToGltf(root: THREE.Object3D): THREE.AnimationClip[] {
  primeBindPose(root)
  const delta = new THREE.Quaternion()
  const composed = new THREE.Quaternion()
  const euler = new THREE.Euler()
  return dummyClips().map((item) => {
    const tracks: THREE.KeyframeTrack[] = []
    for (const track of item.tracks) {
      const remapped = remapDummyClipTrack(root, track, delta, composed, euler)
      if (remapped) tracks.push(remapped)
    }
    return new THREE.AnimationClip(item.name, item.duration, tracks)
  })
}

function remapDummyClipTrack(
  root: THREE.Object3D,
  track: THREE.KeyframeTrack,
  delta: THREE.Quaternion,
  composed: THREE.Quaternion,
  euler: THREE.Euler,
): THREE.KeyframeTrack | null {
  const dot = track.name.indexOf('.')
  if (dot < 0) return track.clone()
  const node = track.name.slice(0, dot)
  const prop = track.name.slice(dot + 1)
  if (!isDummyBoneName(node)) return track.clone()
  const bone = findDummyBone(root, node)
  if (!bone) return null
  const target = bone.name
  if (prop === 'position') {
    const bind = bone.userData.dummyBindPos
    const ox = bind instanceof THREE.Vector3 ? bind.x : 0
    const oy = bind instanceof THREE.Vector3 ? bind.y : 0
    const oz = bind instanceof THREE.Vector3 ? bind.z : 0
    const src = track.values
    const values = new Float32Array(src.length)
    for (let i = 0; i < src.length; i += 3) {
      values[i] = ox + src[i]
      values[i + 1] = oy + src[i + 1]
      values[i + 2] = oz + src[i + 2]
    }
    return new THREE.VectorKeyframeTrack(`${target}.position`, Array.from(track.times), values)
  }
  const axis = /^rotation\[([xyz])\]$/.exec(prop)?.[1] as 'x' | 'y' | 'z' | undefined
  if (!axis) return null
  const bind = bindQuat(bone)
  const values = new Float32Array(track.times.length * 4)
  for (let i = 0; i < track.times.length; i++) {
    euler.set(0, 0, 0, 'XYZ')
    euler[axis] = track.values[i]
    delta.setFromEuler(euler)
    composed.multiplyQuaternions(delta, bind)
    values[i * 4] = composed.x
    values[i * 4 + 1] = composed.y
    values[i * 4 + 2] = composed.z
    values[i * 4 + 3] = composed.w
  }
  return new THREE.QuaternionKeyframeTrack(`${target}.quaternion`, Array.from(track.times), values)
}

function renameClip(item: THREE.AnimationClip, name: string) {
  const next = item.clone()
  next.name = name
  return next
}

function pickGltfDummyClips(clips: THREE.AnimationClip[]): THREE.AnimationClip[] | null {
  const idle = clips.find((item) => /^idle$/i.test(item.name))
  const walk =
    clips.find((item) => /^walking_a$/i.test(item.name)) ??
    clips.find((item) => /walk/i.test(item.name) && !/back/i.test(item.name))
  const run =
    clips.find((item) => /^running_a$/i.test(item.name)) ??
    clips.find((item) => /run/i.test(item.name) && !/strafe/i.test(item.name))
  if (!idle || !walk || !run) return null
  return [renameClip(idle, 'Idle'), renameClip(walk, 'Walk'), renameClip(run, 'Run')]
}

function parseGltf(buffer: ArrayBuffer) {
  return new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((resolve, reject) => {
    new GLTFLoader().parse(
      buffer,
      '',
      (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations ?? [] }),
      reject,
    )
  })
}

function hideDummyExtras(root: THREE.Object3D) {
  root.traverse((node) => {
    if (/^(eyes|eyebrows)$/i.test(node.name)) node.visible = false
  })
}

/**
 * Snapshot bind quaternion + local position before any pose (CozyClay
 * `primeBindPose`). Must run on an untouched clone — a later snapshot
 * would treat a posed arm as rest and explode the skin.
 */
export function primeBindPose(root: THREE.Object3D) {
  if (root.userData.dummyBindPrimed) return
  root.traverse((node) => {
    if (!(node instanceof THREE.Bone)) return
    const pose = DUMMY_GLB_TO_POSE[node.name] ?? (isDummyBoneName(node.name) ? node.name : null)
    if (pose) node.userData.dummyBone = pose
    node.userData.dummyBindQuat = node.quaternion.clone()
    node.userData.dummyBindPos = node.position.clone()
    node.userData.dummyBindScale = node.scale.clone()
  })
  root.userData.dummyBindPrimed = true
}

function bindQuat(bone: THREE.Bone): THREE.Quaternion {
  const stored = bone.userData.dummyBindQuat
  return stored instanceof THREE.Quaternion ? stored : new THREE.Quaternion()
}

function restoreBindTRS(bone: THREE.Bone) {
  const pos = bone.userData.dummyBindPos
  const scale = bone.userData.dummyBindScale
  if (pos instanceof THREE.Vector3) bone.position.copy(pos)
  if (scale instanceof THREE.Vector3) bone.scale.copy(scale)
}

/** Scale a wrapper, never the armature — IBM stays in file space. */
function wrapFittedDummy(scene: THREE.Object3D): THREE.Group {
  const wrap = new THREE.Group()
  wrap.name = 'Dummy'
  wrap.add(scene)
  const box = meshWorldBounds(scene)
  if (boundsAreUsable(box)) {
    const size = box.getSize(new THREE.Vector3())
    wrap.scale.setScalar(2 / Math.max(size.x, size.y, size.z))
    wrap.updateMatrixWorld(true)
    const scaled = meshWorldBounds(wrap)
    if (boundsAreUsable(scaled)) {
      const center = scaled.getCenter(new THREE.Vector3())
      wrap.position.x -= center.x
      wrap.position.z -= center.z
      wrap.position.y -= scaled.min.y
    }
  }
  wrap.userData.dummyGltf = true
  return wrap
}

function instantiateGltfDummy(template: DummyGltfTemplate) {
  const root = SkeletonUtils.clone(template.scene)
  root.name = 'Dummy'
  root.userData = { ...root.userData, dummyGltf: true, dummyBindPrimed: false }
  root.traverse((node) => {
    if (node instanceof THREE.Bone) {
      delete node.userData.dummyBindQuat
      delete node.userData.dummyBindPos
      delete node.userData.dummyBindScale
    }
  })
  primeBindPose(root)
  return root
}

function poseBonesReady(root: THREE.Object3D) {
  return DUMMY_POSE_BONES.every((name) => findDummyBone(root, name))
}

async function buildDummyTemplateFromGltf(buffer: ArrayBuffer, sex: FigureSex): Promise<DummyGltfTemplate | null> {
  const parsed = await parseGltf(buffer)
  prepareImportedRoot(parsed.scene)
  hideDummyExtras(parsed.scene)
  if (!poseBonesReady(parsed.scene)) return null
  primeBindPose(parsed.scene)
  const clips = pickGltfDummyClips(parsed.animations) ?? remapDummyClipsToGltf(parsed.scene)
  const scene = wrapFittedDummy(parsed.scene)
  scene.userData.figureSex = sex
  return { scene, clips }
}

async function loadDummyTemplate(sex: FigureSex): Promise<DummyGltfTemplate | null> {
  const response = await fetch(DUMMY_GLB_URLS[sex])
  if (!response.ok) return null
  return buildDummyTemplateFromGltf(await response.arrayBuffer(), sex)
}

function shouldPrefetchDummy() {
  try {
    return typeof process === 'undefined' || process.env.VITEST !== 'true'
  } catch {
    return true
  }
}

/** Parse once per sex; clone per Figure. Null when the GLB is missing or invalid. */
export function ensureDummyTemplate(sex: FigureSex = 'male'): Promise<DummyGltfTemplate | null> {
  const cached = dummyTemplates[sex]
  if (cached) return Promise.resolve(cached)
  if (!dummyTemplatePromises[sex]) {
    dummyTemplatePromises[sex] = loadDummyTemplate(sex)
      .then((loaded) => {
        if (loaded) dummyTemplates[sex] = loaded
        else delete dummyTemplatePromises[sex]
        return loaded
      })
      .catch(() => {
        delete dummyTemplatePromises[sex]
        return null
      })
  }
  return dummyTemplatePromises[sex]!
}

if (shouldPrefetchDummy()) {
  void ensureDummyTemplate('female')
  void ensureDummyTemplate('male')
}

/** Vitest: install the vendored GLB without going through `fetch`. */
export async function ensureDummyTemplateFromBuffer(sex: FigureSex, buffer: ArrayBuffer) {
  const cached = dummyTemplates[sex]
  if (cached) return cached
  const loaded = await buildDummyTemplateFromGltf(buffer, sex)
  if (loaded) dummyTemplates[sex] = loaded
  return loaded
}

export function resetDummyTemplatesForTests() {
  for (const sex of Object.keys(dummyTemplates) as FigureSex[]) delete dummyTemplates[sex]
  for (const sex of Object.keys(dummyTemplatePromises) as FigureSex[]) delete dummyTemplatePromises[sex]
}

async function upgradeDummyIfNeeded(objectId: string, sex: FigureSex) {
  const loaded = await ensureDummyTemplate(sex)
  if (!loaded) return
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object || object.rigKind !== 'dummy' || object.root.userData.dummyGltf) return
  const root = instantiateGltfDummy(loaded)
  applyDummyBonePose(root, object.bonePose, object.boneTranslate)
  useSceneStore.getState().replaceImportedRoot(objectId, root, loaded.clips)
}

export function isDummyBoneName(name: string): name is DummyBoneName {
  return (DUMMY_POSE_BONES as readonly string[]).includes(name)
}

export function dummyBoneFromObject(node: THREE.Object3D | null): DummyBoneName | null {
  let current = node
  while (current) {
    const tagged = current.userData.dummyBone
    if (typeof tagged === 'string' && isDummyBoneName(tagged)) return tagged
    if (current instanceof THREE.Bone) {
      if (isDummyBoneName(current.name)) return current.name
      const aliased = DUMMY_GLB_TO_POSE[current.name]
      if (aliased) return aliased
    }
    current = current.parent
  }
  return null
}

/** Skinned GLB meshes are not parented to a limb — pick the nearest pose bone. */
export function dummyBoneFromHit(root: THREE.Object3D, point: THREE.Vector3): DummyBoneName | null {
  let best: DummyBoneName | null = null
  let bestDist = Infinity
  const world = new THREE.Vector3()
  for (const name of DUMMY_POSE_BONES) {
    const bone = findDummyBone(root, name)
    if (!bone) continue
    bone.getWorldPosition(world)
    const dist = world.distanceToSquared(point)
    if (dist < bestDist) {
      bestDist = dist
      best = name
    }
  }
  return best
}

function boneNameMatches(boneName: string, poseName: string) {
  if (boneName === poseName) return true
  if (isDummyBoneName(poseName) && DUMMY_BONE_ALIASES[poseName] === boneName) return true
  return false
}

function isDescendantOf(bone: THREE.Object3D, ancestors: THREE.Object3D[]) {
  for (let parent = bone.parent; parent; parent = parent.parent) {
    if (ancestors.includes(parent)) return true
  }
  return false
}

export function findDummyBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  const matches: THREE.Bone[] = []
  root.traverse((node) => {
    if (node instanceof THREE.Bone && boneNameMatches(node.name, name)) matches.push(node)
  })
  const written: THREE.Bone[] = []
  for (const bone of matches) {
    if (written.length && isDescendantOf(bone, written)) continue
    written.push(bone)
  }
  return written[0] ?? null
}

const _delta = new THREE.Quaternion()
const _bindInv = new THREE.Quaternion()
const _euler = new THREE.Euler()

/** Pose Euler (degrees) is a delta on bind: q = delta * bind (CozyClay applyPose). */
export function applyDummyBonePose(
  root: THREE.Object3D,
  pose?: Record<string, Vec3>,
  translate?: Record<string, Vec3>,
) {
  primeBindPose(root)
  const rest = dummyRestPose(root)
  for (const name of DUMMY_POSE_BONES) {
    const bone = findDummyBone(root, name)
    if (!bone) continue
    const euler = pose?.[name] ?? rest[name]
    _euler.set(euler[0] * DEG, euler[1] * DEG, euler[2] * DEG, 'XYZ')
    _delta.setFromEuler(_euler)
    bone.quaternion.multiplyQuaternions(_delta, bindQuat(bone))
    const stored = translate?.[name]
    const bindPos = bone.userData.dummyBindPos
    if (stored) bone.position.set(stored[0], stored[1], stored[2])
    else if (bindPos instanceof THREE.Vector3) bone.position.copy(bindPos)
    restoreBindScale(bone)
  }
  root.updateMatrixWorld(true)
}

export function readDummyBonePose(root: THREE.Object3D): Record<string, Vec3> {
  primeBindPose(root)
  const pose: Record<string, Vec3> = {}
  for (const name of DUMMY_POSE_BONES) {
    const bone = findDummyBone(root, name)
    if (!bone) continue
    _bindInv.copy(bindQuat(bone)).invert()
    _delta.copy(bone.quaternion).multiply(_bindInv)
    _euler.setFromQuaternion(_delta, 'XYZ')
    pose[name] = [_euler.x / DEG, _euler.y / DEG, _euler.z / DEG]
  }
  return pose
}

const TRANSLATE_EPS = 1e-5

/** Local bone positions that left bind. Empty object when the figure is at rest. */
export function readDummyBoneTranslate(root: THREE.Object3D): Record<string, Vec3> {
  primeBindPose(root)
  const translate: Record<string, Vec3> = {}
  for (const name of DUMMY_POSE_BONES) {
    const bone = findDummyBone(root, name)
    if (!bone) continue
    const bind = bone.userData.dummyBindPos
    if (!(bind instanceof THREE.Vector3)) continue
    if (bone.position.distanceTo(bind) <= TRANSLATE_EPS) continue
    translate[name] = [bone.position.x, bone.position.y, bone.position.z]
  }
  return translate
}

export function compactDummyTranslate(translate: Record<string, Vec3>): Record<string, Vec3> | undefined {
  return Object.keys(translate).length ? translate : undefined
}

export function listDummyPoseBones(root: THREE.Object3D): DummyBoneName[] {
  return DUMMY_POSE_BONES.filter((name) => findDummyBone(root, name))
}

const _parentInv = new THREE.Quaternion()
const _localPos = new THREE.Vector3()

function restoreBindScale(bone: THREE.Bone) {
  const scale = bone.userData.dummyBindScale
  if (scale instanceof THREE.Vector3) bone.scale.copy(scale)
  else bone.scale.set(1, 1, 1)
}

/**
 * Map a world-space proxy gizmo onto a bone. Rotate writes quaternion
 * only; translate writes local position only. Scale is always bind.
 */
export function applyDummyBoneWorldTransform(
  bone: THREE.Bone,
  worldPosition: THREE.Vector3,
  worldQuaternion: THREE.Quaternion,
  mode: 'translate' | 'rotate',
) {
  const parent = bone.parent
  if (!parent) return
  parent.updateWorldMatrix(true, false)
  if (mode === 'rotate') {
    parent.getWorldQuaternion(_parentInv).invert()
    bone.quaternion.copy(_parentInv).multiply(worldQuaternion)
  } else {
    _localPos.copy(worldPosition)
    parent.worldToLocal(_localPos)
    bone.position.copy(_localPos)
  }
  restoreBindScale(bone)
  bone.updateMatrixWorld(true)
}

/** Bundled grayscale figure (E9 / E18). Local clips; no Fal. Pose when Play clips is off. */
export function makeDummyObject(
  options: {
    name?: string
    transform?: SceneObject['transform']
    keys?: SceneObject['keys']
    playClips?: boolean
    activeClip?: string
    id?: string
    shade?: number
    clayColor?: string
    bonePose?: Record<string, Vec3>
    boneTranslate?: Record<string, Vec3>
    figureSex?: FigureSex
    displayMode?: AssetDisplayMode
    triangleCount?: number
  } = {},
) {
  const sex = options.figureSex ?? 'male'
  const gltf = dummyTemplates[sex]
  const root = gltf ? instantiateGltfDummy(gltf) : makeDummyRoot()
  root.userData.figureSex = sex
  if (options.bonePose || options.boneTranslate) {
    applyDummyBonePose(root, options.bonePose, options.boneTranslate)
  }
  const label = sex === 'female' ? 'Female' : 'Male'
  return makeObject(options.name ?? label, root, {
    id: options.id,
    shade: options.shade,
    clayColor: options.clayColor,
    clips: gltf ? gltf.clips : dummyClips(),
    playClips: options.playClips ?? false,
    activeClip: options.activeClip ?? 'Idle',
    rigKind: 'dummy',
    transform: options.transform,
    keys: options.keys,
    bonePose: options.bonePose,
    boneTranslate: options.boneTranslate,
    figureSex: sex,
    displayMode: options.displayMode,
    triangleCount: options.triangleCount,
  })
}

export function addDummyToScene(sex: FigureSex = 'male') {
  const object = makeDummyObject({ figureSex: sex })
  useSceneStore.getState().addObject(object)
  useEditorStore.getState().select(`obj:${object.id}`)
  if (!object.root.userData.dummyGltf) void upgradeDummyIfNeeded(object.id, sex)
  return object.id
}

/** Wait briefly for the vendored GLB (falls back to capsules if load fails). */
export async function addDummyToSceneWhenReady(sex: FigureSex = 'male') {
  await Promise.race([
    ensureDummyTemplate(sex),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 4000)
    }),
  ])
  return addDummyToScene(sex)
}

export function setDummyBoneAxis(objectId: string, bone: DummyBoneName, axis: 0 | 1 | 2, value: number) {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object || object.rigKind !== 'dummy') return
  const rest = dummyRestPose(object.root)
  const current = object.bonePose?.[bone] ?? rest[bone]
  const nextBone: Vec3 = [current[0], current[1], current[2]]
  nextBone[axis] = value
  const bonePose = { ...rest, ...object.bonePose, [bone]: nextBone }
  applyDummyBonePose(object.root, bonePose, object.boneTranslate)
  useSceneStore.getState().setDummyFk(objectId, {
    bonePose,
    boneTranslate: object.boneTranslate,
    playClips: false,
  })
}

export function commitDummyFk(objectId: string) {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object || object.rigKind !== 'dummy') return
  useSceneStore.getState().setDummyFk(objectId, {
    bonePose: readDummyBonePose(object.root),
    boneTranslate: compactDummyTranslate(readDummyBoneTranslate(object.root)),
    playClips: false,
  })
}

export function resetDummyBonePose(objectId: string) {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object || object.rigKind !== 'dummy') return
  object.root.traverse((node) => {
    if (node instanceof THREE.Bone) restoreBindTRS(node)
  })
  applyDummyBonePose(object.root, dummyRestPose(object.root))
  useSceneStore.getState().setDummyFk(objectId, {
    bonePose: undefined,
    boneTranslate: undefined,
  })
}
