import { describe, expect, it } from 'vitest'
import {
  IDENTITY_ENV_TRANSFORM,
  assignEnvironmentId,
  collectProjectBufferKeys,
  environmentDeleteMessage,
  environmentFileKind,
  environmentRecordFormat,
  makeFixtureSplatPly,
  partitionDroppedSceneFiles,
  patchEnvTransform,
  showEnvironmentSplat,
} from './environment'

describe('assignEnvironmentId', () => {
  it('resets pose when the palco id changes', () => {
    const next = assignEnvironmentId('beach', 'studio', {
      position: [4, 1, 0],
      rotation: [0, 45, 0],
      scale: [2, 2, 2],
    })
    expect(next.environmentId).toBe('studio')
    expect(next.environmentTransform).toEqual(IDENTITY_ENV_TRANSFORM)
  })

  it('keeps pose when assigning the same palco', () => {
    const pose = { position: [1, 0, 0] as [number, number, number], rotation: [0, 10, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] }
    const next = assignEnvironmentId('beach', 'beach', pose)
    expect(next.environmentTransform.position).toEqual([1, 0, 0])
    expect(next.environmentTransform.rotation).toEqual([0, 10, 0])
  })
})

describe('environmentDeleteMessage', () => {
  it('refuses delete while any scene still points at the palco', () => {
    expect(
      environmentDeleteMessage(
        [{ environmentId: 'beach' }, { environmentId: 'beach' }, { environmentId: null }],
        'beach',
      ),
    ).toBe('Used in 2 scenes')
  })

  it('allows delete when nothing points at it', () => {
    expect(environmentDeleteMessage([{ environmentId: 'other' }], 'beach')).toBeNull()
  })
})

describe('environmentFileKind', () => {
  it('accepts ply and splat only', () => {
    expect(environmentFileKind('room.ply')).toBe('ply')
    expect(environmentFileKind('room.SPLAT')).toBe('splat')
    expect(environmentFileKind('room.glb')).toBeNull()
    expect(environmentFileKind('room.spz')).toBeNull()
  })

  it('splits dropped models from palco files', () => {
    const { models, environments } = partitionDroppedSceneFiles([
      new File([], 'prop.glb'),
      new File([], 'stage.ply'),
      new File([], 'notes.txt'),
    ])
    expect(models.map((file) => file.name)).toEqual(['prop.glb'])
    expect(environments.map((file) => file.name)).toEqual(['stage.ply'])
  })
})

describe('environmentRecordFormat', () => {
  it('keeps splat after the library name drops the extension', () => {
    expect(environmentRecordFormat({ name: 'Studio', format: 'splat' })).toBe('splat')
    expect(environmentRecordFormat({ name: 'room.splat' })).toBe('splat')
    expect(environmentRecordFormat({ name: 'Studio' })).toBe('ply')
  })
})

describe('patchEnvTransform', () => {
  it('writes one axis and can scale uniformly', () => {
    const moved = patchEnvTransform(IDENTITY_ENV_TRANSFORM, 'position', 0, 3)
    expect(moved.position).toEqual([3, 0, 0])
    const scaled = patchEnvTransform(moved, 'scale', 1, 2, true)
    expect(scaled.scale).toEqual([2, 2, 2])
  })
})

describe('makeFixtureSplatPly', () => {
  it('writes an INRIA-style Gaussian header', () => {
    const text = new TextDecoder().decode(makeFixtureSplatPly())
    expect(text.startsWith('ply')).toBe(true)
    expect(text).toContain('format binary_little_endian 1.0')
    expect(text).toContain('property float f_dc_0')
    expect(text).toContain('end_header')
  })

  it('is accepted by the gaussian-splats-3d PLY parser', async () => {
    const { PlyParser } = await import('@mkkellogg/gaussian-splats-3d')
    const parsed = (
      PlyParser as { parseToUncompressedSplatArray: (data: ArrayBuffer) => { splatCount: number } }
    ).parseToUncompressedSplatArray(makeFixtureSplatPly())
    expect(parsed.splatCount).toBe(4)
  })
})

describe('showEnvironmentSplat', () => {
  it('composites in the editor clay view and on the Look pass', () => {
    expect(showEnvironmentSplat('clay', false)).toBe(true)
    expect(showEnvironmentSplat('look', true)).toBe(true)
  })

  it('hides the splat on mesh export passes', () => {
    expect(showEnvironmentSplat('clay', true)).toBe(false)
    expect(showEnvironmentSplat('depth', true)).toBe(false)
    expect(showEnvironmentSplat('outline', false)).toBe(false)
  })
})

describe('collectProjectBufferKeys', () => {
  it('keeps environment and unplaced bytes from being swept', () => {
    const keys = collectProjectBufferKeys(
      [{ id: 'e1', name: 'Beach', bufferKey: 'env-buf', source: 'import', createdAt: 1, sourceImageKey: 'img-1' }],
      [{ id: 'a1', name: 'Chair', bufferKey: 'mesh-buf', rigKind: 'none' }],
    )
    expect(keys).toEqual(['env-buf', 'img-1', 'mesh-buf'])
  })
})
