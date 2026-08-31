import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

let shared: GLTFLoader | null = null

/** One loader for remesh + import. Tripo remesh often ships Draco / meshopt GLBs. */
export function gltfLoader(): GLTFLoader {
  if (shared) return shared
  const loader = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath('/draco/')
  loader.setDRACOLoader(draco)
  loader.setMeshoptDecoder(MeshoptDecoder)
  shared = loader
  return loader
}

export function parseGlbScene(buffer: ArrayBuffer): Promise<{
  scene: THREE.Object3D
  clips: THREE.AnimationClip[]
}> {
  return new Promise((resolve, reject) => {
    gltfLoader().parse(
      buffer,
      '',
      (gltf) => resolve({ scene: gltf.scene, clips: gltf.animations ?? [] }),
      reject,
    )
  })
}

export function resetGltfLoaderForTests() {
  shared = null
}
