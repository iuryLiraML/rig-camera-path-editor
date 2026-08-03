import { describe, expect, it } from 'vitest'
import { sceneAssetContentTypeFromFile } from './sceneAssets'

describe('scene asset helpers', () => {
  it('maps glb and gltf files to the expected content types', () => {
    expect(
      sceneAssetContentTypeFromFile(new File(['x'], 'hero.glb', { type: 'model/gltf-binary' })),
    ).toBe('model/gltf-binary')
    expect(
      sceneAssetContentTypeFromFile(new File(['x'], 'scene.gltf', { type: 'model/gltf+json' })),
    ).toBe('model/gltf+json')
    expect(sceneAssetContentTypeFromFile(new File(['x'], 'notes.txt'))).toBeNull()
  })
})
