import { describe, expect, it } from 'vitest'
import {
  canonicalSidecarJson,
  frameFromBounds,
  LOCATION_SIDECAR_FORMAT_VERSION,
  locationTransform,
  parseLocationSidecar,
  sidecarChecksum,
  type LocationSidecar,
} from './locationSidecar'

/**
 * E1.4 — the versioned Location sidecar (roadmap; ARCHITECTURE-GS §9.1 step 5).
 *
 * Today `demoConfig.ts` hard-codes `eulerDegrees: [-90, 0, 0]` with the comment
 * "Dataset often authored Z-up", plus a camera position and focus point picked by
 * hand for that one dataset. Every ingested Location would need the same
 * guessing. The sidecar turns those into data the ingest writes and StageHost
 * reads: units, up axis, transform, bounds, and a version.
 *
 * AC: sidecar JSON immutable per revision; StageHost reads meters Y-up.
 */

const valid = (over: Partial<LocationSidecar> = {}): LocationSidecar => ({
  formatVersion: LOCATION_SIDECAR_FORMAT_VERSION,
  revision: 'rev-1',
  units: 'meters',
  upAxis: 'y',
  transform: { position: [0, 0, 0], eulerDegrees: [0, 0, 0], scale: 1 },
  bounds: { min: [-4, 0, -4], max: [4, 3, 4] },
  source: { format: 'ply', byteSize: 1024, sha256: 'a'.repeat(64) },
  ...over,
})

/** a sidecar with its checksum filled in, the way ingest would publish it */
const published = (over: Partial<LocationSidecar> = {}): LocationSidecar => {
  const sidecar = valid(over)
  return { ...sidecar, checksum: sidecarChecksum(sidecar) }
}

describe('parseLocationSidecar', () => {
  it('accepts a sidecar ingest would write', () => {
    const result = parseLocationSidecar(published())
    expect(result.ok).toBe(true)
  })

  it('refuses a format version it was not written for, instead of misreading it', () => {
    const result = parseLocationSidecar(published({ formatVersion: 99 }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('99')
    expect(result.message).toContain(String(LOCATION_SIDECAR_FORMAT_VERSION))
  })

  it('insists on meters, because the runtime has no unit conversion', () => {
    const result = parseLocationSidecar(published({ units: 'feet' as never }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toMatch(/meters/)
  })

  it('names the offending field in English', () => {
    for (const [patch, needle] of [
      [{ bounds: { min: [1, 1, 1], max: [0, 0, 0] } }, 'bounds'],
      [{ transform: { position: [0, 0], eulerDegrees: [0, 0, 0], scale: 1 } }, 'position'],
      [{ transform: { position: [0, 0, 0], eulerDegrees: [0, 0, 0], scale: 0 } }, 'scale'],
      [{ source: { format: 'exe', byteSize: 1, sha256: 'a'.repeat(64) } }, 'format'],
      [{ revision: '' }, 'revision'],
    ] as [Partial<LocationSidecar>, string][]) {
      const result = parseLocationSidecar(published(patch))
      expect(result.ok, needle).toBe(false)
      if (result.ok) continue
      expect(result.message.toLowerCase()).toContain(needle.toLowerCase())
    }
  })

  it('rejects anything that is not an object', () => {
    for (const input of [null, undefined, 42, 'sidecar', []]) {
      expect(parseLocationSidecar(input).ok, String(input)).toBe(false)
    }
  })
})

describe('revision immutability', () => {
  it('detects a sidecar edited after publication', () => {
    // the AC: a revision's JSON is immutable. The checksum is over the content,
    // so editing any meaningful field without re-publishing is caught.
    const sidecar = published()
    const tampered = { ...sidecar, transform: { ...sidecar.transform, scale: 2 } }
    const result = parseLocationSidecar(tampered)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toMatch(/checksum|modified/i)
  })

  it('is stable regardless of key order', () => {
    const sidecar = valid()
    const reordered = {
      source: sidecar.source,
      bounds: sidecar.bounds,
      transform: sidecar.transform,
      upAxis: sidecar.upAxis,
      units: sidecar.units,
      revision: sidecar.revision,
      formatVersion: sidecar.formatVersion,
    } as LocationSidecar
    expect(sidecarChecksum(reordered)).toBe(sidecarChecksum(sidecar))
    expect(canonicalSidecarJson(reordered)).toBe(canonicalSidecarJson(sidecar))
  })

  it('changes when a meaningful field changes', () => {
    const base = valid()
    expect(sidecarChecksum({ ...base, revision: 'rev-2' })).not.toBe(sidecarChecksum(base))
    expect(sidecarChecksum({ ...base, upAxis: 'z' })).not.toBe(sidecarChecksum(base))
  })

  it('accepts a sidecar with no checksum yet (pre-publication draft)', () => {
    // ingest computes the checksum last; a draft must still parse
    const result = parseLocationSidecar(valid())
    expect(result.ok).toBe(true)
  })
})

describe('locationTransform', () => {
  it('leaves a Y-up dataset alone', () => {
    const transform = locationTransform(valid({ upAxis: 'y' }))
    expect(transform.eulerDegrees).toEqual([0, 0, 0])
  })

  it('reproduces the -90 X rotation the demo hard-codes for Z-up data', () => {
    // demoConfig.ts currently carries this as a magic number per dataset; with a
    // sidecar it is derived from `upAxis`
    const transform = locationTransform(valid({ upAxis: 'z' }))
    expect(transform.eulerDegrees).toEqual([-90, 0, 0])
  })

  it('composes the authored transform on top of the up-axis correction', () => {
    const transform = locationTransform(
      valid({
        upAxis: 'z',
        transform: { position: [1, 2, 3], eulerDegrees: [0, 45, 0], scale: 2 },
      }),
    )
    expect(transform.position).toEqual([1, 2, 3])
    expect(transform.eulerDegrees).toEqual([-90, 45, 0])
    expect(transform.scale).toBe(2)
  })
})

describe('frameFromBounds', () => {
  it('derives a camera framing instead of hard-coding one per dataset', () => {
    const frame = frameFromBounds(valid().bounds)
    expect(frame.center).toEqual([0, 1.5, 0])
    // radius covers the box, so the camera distance can be derived from it
    expect(frame.radius).toBeGreaterThan(4)
    expect(frame.distance).toBeGreaterThan(frame.radius)
  })

  it('survives a degenerate box without producing NaN or zero distance', () => {
    const frame = frameFromBounds({ min: [0, 0, 0], max: [0, 0, 0] })
    expect(Number.isFinite(frame.distance)).toBe(true)
    expect(frame.distance).toBeGreaterThan(0)
  })
})
