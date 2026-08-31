import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import type * as THREE from 'three'
import { isGltfMeshBuffer } from './assetSniff'
import { countGltfTriangles } from './glbTriangleCount'

export type ModelFormat = 'gltf' | 'obj'

export type ParsedModel = {
  scene: THREE.Object3D
  clips: THREE.AnimationClip[]
}

export const MODEL_FORMATS = {
  gltf: {
    extension: 'glb',
    contentType: 'model/gltf-binary',
    accepts: isGltfMeshBuffer,
  },
  obj: {
    extension: 'obj',
    contentType: 'text/plain',
    accepts: () => true,
  },
} satisfies Record<
  ModelFormat,
  { extension: string; contentType: string; accepts: (buffer: ArrayBuffer) => boolean }
>

export function modelFormatFromFilename(filename: string): ModelFormat {
  return /\.obj$/i.test(filename) ? 'obj' : 'gltf'
}

export function modelNameFromFilename(filename: string): string {
  return filename.replace(/\.(glb|gltf|obj)$/i, '')
}

export function countObjTriangles(buffer: ArrayBuffer): number {
  let total = 0
  const text = new TextDecoder().decode(buffer)
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('f ')) continue
    total += Math.max(0, trimmed.split(/\s+/).length - 3)
  }
  return total
}

export function estimateSourceTriangles(
  buffer: ArrayBuffer,
  format: ModelFormat,
): number | null {
  return format === 'obj' ? countObjTriangles(buffer) : countGltfTriangles(buffer)
}

export function parseModelBuffer(
  buffer: ArrayBuffer,
  format: ModelFormat,
): Promise<ParsedModel> {
  if (format === 'obj') {
    return Promise.resolve({
      scene: new OBJLoader().parse(new TextDecoder().decode(buffer)),
      clips: [],
    })
  }
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      buffer,
      '',
      (gltf) => resolve({ scene: gltf.scene, clips: gltf.animations ?? [] }),
      reject,
    )
  })
}
