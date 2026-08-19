// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { HEAVY_TRIANGLES, RETOPO_TRIANGLES } from '../lib/sceneIO'
import { denseImportCopy } from './ImportAssetsModal'

describe('Import remesh warning', () => {
  it('recommends remesh above 80k triangles', () => {
    expect(RETOPO_TRIANGLES).toBe(80_000)
    const copy = denseImportCopy('Car', 90_000)
    expect(copy).toContain('Car')
    expect(copy).toContain('90k triangles')
    expect(copy).toContain('retopology recommended')
    expect(copy).toContain('Remesh with Tripo')
  })

  it('warns about low FPS above 1.5M triangles', () => {
    expect(HEAVY_TRIANGLES).toBe(1_500_000)
    const copy = denseImportCopy('City', 2_000_000)
    expect(copy).toContain('2.0M triangles')
    expect(copy).toContain('expect low FPS')
  })
})
