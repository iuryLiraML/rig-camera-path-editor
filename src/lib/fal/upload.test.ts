import { describe, expect, it } from 'vitest'
import { DATA_URI_LIMIT, uploadUsesDataUri } from './client'

describe('uploadUsesDataUri', () => {
  it('keeps small images on the data-URI path', () => {
    expect(uploadUsesDataUri(new File([new Uint8Array(12)], 'ref.png', { type: 'image/png' }))).toBe(
      true,
    )
  })

  it('never base64-encodes a GLB, even when it is under the size cap', () => {
    expect(
      uploadUsesDataUri(new File([new Uint8Array(12)], 'car.glb', { type: 'model/gltf-binary' })),
    ).toBe(false)
    expect(uploadUsesDataUri(new File([new Uint8Array(12)], 'car.glb'))).toBe(false)
    expect(uploadUsesDataUri(new File([new Uint8Array(12)], 'room.ply'))).toBe(false)
    expect(uploadUsesDataUri(new File([new Uint8Array(12)], 'room.splat'))).toBe(false)
  })

  it('sends large files through storage upload', () => {
    expect(
      uploadUsesDataUri(new File([new Uint8Array(DATA_URI_LIMIT + 1)], 'ref.png', { type: 'image/png' })),
    ).toBe(false)
  })
})
