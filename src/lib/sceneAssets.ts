import { sha256HexFromBlob } from './brief/parseBrief'
import { importModelFile } from './sceneIO'
import { makeSceneId, useSceneStore } from '../state/useSceneStore'
import type { SceneAssetContentType, SceneAssetRecord } from './projectWorkflow'

export const SCENE_ASSET_ACCEPT = '.glb,.gltf'

const SCENE_ASSET_EXTENSIONS: Record<string, SceneAssetContentType> = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
}

export function sceneAssetContentTypeFromFile(file: File): SceneAssetContentType | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return SCENE_ASSET_EXTENSIONS[extension] ?? null
}

/** Removes the default torus-knot placeholder when it is the only scene object. */
export function clearSeedObjectsIfOnlyPlaceholder() {
  const { objects, removeObject } = useSceneStore.getState()
  if (objects.length !== 1) return
  const only = objects[0]
  const isSeed = only.bufferKey === null && !only.primitive && only.name === 'Torus Knot'
  if (isSeed) removeObject(only.id)
}

export async function importIntakeSceneAsset(file: File): Promise<SceneAssetRecord | null> {
  const contentType = sceneAssetContentTypeFromFile(file)
  if (!contentType) {
    throw new Error('Unsupported model format. Use .glb or .gltf.')
  }

  clearSeedObjectsIfOnlyPlaceholder()
  const imported = await importModelFile(file)
  if (!imported) return null

  return {
    id: makeSceneId('asset'),
    sceneObjectId: imported.objectId,
    fileName: file.name,
    contentType,
    byteSize: imported.byteSize,
    sha256: await sha256HexFromBlob(file),
    cloudAssetId: null,
    importedAt: new Date().toISOString(),
  }
}
