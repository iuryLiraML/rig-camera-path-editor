import * as THREE from 'three'
import { makeObject, useSceneStore, type SceneObject } from '../state/useSceneStore'
import { useEditorStore } from '../state/useEditorStore'

function bone(name: string, parent: THREE.Object3D, y: number, height: number, radius: number) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, height, 4, 8))
  mesh.name = name
  mesh.position.y = y
  parent.add(mesh)
  return mesh
}

function makeDummyRoot(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'Dummy'
  const hips = new THREE.Group()
  hips.name = 'Hips'
  root.add(hips)
  bone('Torso', hips, 0.85, 0.7, 0.18)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10))
  head.name = 'Head'
  head.position.y = 1.45
  hips.add(head)
  const leftArm = bone('LeftArm', hips, 1.05, 0.55, 0.07)
  leftArm.position.set(-0.28, 1.05, 0)
  leftArm.rotation.z = 0.2
  const rightArm = bone('RightArm', hips, 1.05, 0.55, 0.07)
  rightArm.position.set(0.28, 1.05, 0)
  rightArm.rotation.z = -0.2
  bone('LeftLeg', hips, 0.28, 0.55, 0.09).position.set(-0.12, 0.28, 0)
  bone('RightLeg', hips, 0.28, 0.55, 0.09).position.set(0.12, 0.28, 0)
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

/** Bundled grayscale dummy (E9 / E18). Local clips; no Fal. */
export function makeDummyObject(
  options: {
    name?: string
    transform?: SceneObject['transform']
    keys?: SceneObject['keys']
    playClips?: boolean
    activeClip?: string
    id?: string
    shade?: number
  } = {},
) {
  return makeObject(options.name ?? 'Dummy', makeDummyRoot(), {
    id: options.id,
    shade: options.shade,
    clips: dummyClips(),
    playClips: options.playClips ?? true,
    activeClip: options.activeClip ?? 'Idle',
    rigKind: 'dummy',
    transform: options.transform,
    keys: options.keys,
  })
}

export function addDummyToScene() {
  const object = makeDummyObject()
  useSceneStore.getState().addObject(object)
  useEditorStore.getState().select(`obj:${object.id}`)
  return object.id
}
