import { describe, expect, it } from 'vitest'
import { assertGaussianSplat, assertGlbMesh, sniffAsset } from './assetSniff'
import { makeFixtureSplatPly } from './environment'

function asciiPly(): ArrayBuffer {
  return new TextEncoder().encode(
    `ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n`,
  ).buffer
}

function glbHeader(): ArrayBuffer {
  const bytes = new Uint8Array(12)
  new DataView(bytes.buffer).setUint32(0, 0x46546c67, true)
  return bytes.buffer
}

describe('sniffAsset', () => {
  it('classifies the compositor fixture as binary PLY', () => {
    expect(sniffAsset(makeFixtureSplatPly())).toBe('ply-binary')
  })

  it('rejects ASCII PLY the DropInViewer cannot parse', () => {
    expect(sniffAsset(asciiPly())).toBe('ply-ascii')
    expect(() => assertGaussianSplat(asciiPly(), 'room.ply')).toThrow(/ASCII PLY/)
  })

  it('does not treat a GLB as a palco', () => {
    expect(sniffAsset(glbHeader())).toBe('glb')
    expect(() => assertGaussianSplat(glbHeader(), 'room.ply')).toThrow(/GLB mesh/)
  })

  it('does not treat Fal PNG placeholders or HTML error pages as meshes', () => {
    expect(sniffAsset(new TextEncoder().encode('<!doctype html>').buffer)).toBe('html')
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(sniffAsset(png.buffer)).toBe('png')
    expect(() => assertGlbMesh(png.buffer)).toThrow(/not a GLB/)
  })

  it('accepts packed .splat bytes even when Fal names the file .ply', () => {
    const raw = new Uint8Array(32 * 1024)
    expect(assertGaussianSplat(raw.buffer, 'room.ply')).toBe('splat')
  })
})
