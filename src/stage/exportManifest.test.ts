import { describe, expect, it } from 'vitest'
import {
  createDemoExportManifest,
  LOCKED_MAX_LOD,
  LOCKED_SPLAT_BUDGET,
  samplePathTimes,
} from './exportManifest'

describe('samplePathTimes', () => {
  it('returns inclusive 0..1 samples', () => {
    expect(samplePathTimes(5)).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('clamps count below 2 up to 2 samples', () => {
    expect(samplePathTimes(1)).toEqual([0, 1])
  })
})

describe('createDemoExportManifest', () => {
  it('builds a locked-quality contract for the demo Location', () => {
    const manifest = createDemoExportManifest()
    expect(manifest.gaussianBudget).toBe(LOCKED_SPLAT_BUDGET)
    expect(manifest.maxLod).toBe(LOCKED_MAX_LOD)
    expect(manifest.pathSamples[0]).toBe(0)
    expect(manifest.pathSamples[manifest.pathSamples.length - 1]).toBe(1)
    expect(manifest.pathSamples.length).toBe(9)
    expect(manifest.assetVersions).toEqual([
      { spaceId: 'demo', assetId: 'roman-parish-streamed-sog', version: 1 },
    ])
    expect(manifest.warmTimeoutMs).toBeGreaterThan(0)
  })

  it('accepts explicit path samples and budget overrides', () => {
    const manifest = createDemoExportManifest({
      gaussianBudget: 1_000_000,
      maxLod: 2,
      pathSamples: [0, 0.5, 1],
      fps: 30,
    })
    expect(manifest.gaussianBudget).toBe(1_000_000)
    expect(manifest.maxLod).toBe(2)
    expect(manifest.pathSamples).toEqual([0, 0.5, 1])
    expect(manifest.fps).toBe(30)
  })

  it('densifies warm path samples for longer durations', () => {
    const short = createDemoExportManifest({ durationS: 6 })
    const long = createDemoExportManifest({ durationS: 12 })
    expect(short.pathSamples.length).toBe(9)
    expect(long.pathSamples.length).toBe(18)
    expect(long.pathSamples[0]).toBe(0)
    expect(long.pathSamples[long.pathSamples.length - 1]).toBe(1)
  })
})
