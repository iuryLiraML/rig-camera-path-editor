/**
 * The Location sidecar — what ingest publishes next to a Streamed SOG tree, and
 * the only thing StageHost needs to place a Location correctly
 * (ARCHITECTURE-GS §9.1 step 5; roadmap E1.4).
 *
 * Without it, every dataset needs hand-tuning: `demoConfig.ts` carries
 * `eulerDegrees: [-90, 0, 0]` with the comment "Dataset often authored Z-up",
 * plus a camera position and focus point chosen by eye for that one capture. The
 * sidecar turns each of those into data — up axis, transform, bounds — so the
 * runtime derives them instead of guessing.
 *
 * Deliberately dependency-free: no zod (the browser bundle does not ship it) and
 * no PlayCanvas, so the same contract can be validated on either side of the
 * wire. The server cannot import this file yet — `server/tsconfig.json` has
 * `rootDir: "."` — so when the IngestWorker writes sidecars (E1.3) it needs a
 * shared build target. That is an E1.3 decision, not something to pre-build here.
 */

/** Bumped only for a breaking change; readers refuse versions they don't know. */
export const LOCATION_SIDECAR_FORMAT_VERSION = 1

/** Capture formats ingest can produce a Location from (see `ingestSources.ts`). */
export const SIDECAR_SOURCE_FORMATS = ['ply', 'spz', 'sog', 'sog-package', 'streamed-sog'] as const
export type SidecarSourceFormat = (typeof SIDECAR_SOURCE_FORMATS)[number]

export type Vec3 = [number, number, number]

export interface SidecarBounds {
  min: Vec3
  max: Vec3
}

export interface LocationSidecar {
  formatVersion: number
  /** immutable id of this publication; a new ingest run produces a new revision */
  revision: string
  /** the runtime has no unit conversion, so this is the assertion that it fits */
  units: 'meters'
  /** the axis the capture treats as up; the runtime is Y-up */
  upAxis: 'y' | 'z'
  transform: {
    position: Vec3
    eulerDegrees: Vec3
    scale: number
  }
  bounds: SidecarBounds
  source: {
    format: SidecarSourceFormat
    byteSize: number
    sha256: string
  }
  /** content hash, filled in when the revision is published */
  checksum?: string
  splatCount?: number
  createdAt?: string
}

export type SidecarParseResult =
  | { ok: true; sidecar: LocationSidecar }
  | { ok: false; message: string }

// ---------------------------------------------------------------------------
// Canonical form + checksum
// ---------------------------------------------------------------------------

/**
 * Stable serialization: keys sorted, so two readers agree on the bytes being
 * hashed regardless of how the JSON was written. `checksum` itself is excluded —
 * it describes the rest.
 */
export function canonicalSidecarJson(sidecar: LocationSidecar): string {
  const sortValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortValue)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => key !== 'checksum')
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, inner]) => [key, sortValue(inner)]),
      )
    }
    return value
  }
  return JSON.stringify(sortValue(sidecar))
}

/**
 * FNV-1a over the canonical JSON. This guards against a revision being edited in
 * place — accidental mutation, a partial write, a hand-tweaked file — not against
 * a determined forger; authenticity is the API's job, not the sidecar's.
 */
export function sidecarChecksum(sidecar: LocationSidecar): string {
  const json = canonicalSidecarJson(sidecar)
  let hash = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const fail = (message: string): SidecarParseResult => ({ ok: false, message })

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n))

export function parseLocationSidecar(input: unknown): SidecarParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fail('The Location sidecar must be a JSON object.')
  }
  const raw = input as Record<string, unknown>

  if (raw.formatVersion !== LOCATION_SIDECAR_FORMAT_VERSION) {
    return fail(
      `This Location sidecar declares format version ${String(raw.formatVersion)}, but this build reads version ${LOCATION_SIDECAR_FORMAT_VERSION}. Re-ingest the Location, or update the app.`,
    )
  }

  if (typeof raw.revision !== 'string' || raw.revision.trim() === '') {
    return fail('The Location sidecar is missing a revision id.')
  }

  if (raw.units !== 'meters') {
    return fail(
      `Location units must be meters, not ${String(raw.units)} — the runtime does not convert units.`,
    )
  }

  if (raw.upAxis !== 'y' && raw.upAxis !== 'z') {
    return fail(`The Location up axis must be "y" or "z", not ${String(raw.upAxis)}.`)
  }

  const transform = raw.transform as Record<string, unknown> | undefined
  if (!transform || typeof transform !== 'object') {
    return fail('The Location sidecar is missing its transform.')
  }
  if (!isVec3(transform.position)) {
    return fail('The transform position must be three finite numbers [x, y, z].')
  }
  if (!isVec3(transform.eulerDegrees)) {
    return fail('The transform eulerDegrees must be three finite numbers [x, y, z].')
  }
  if (typeof transform.scale !== 'number' || !(transform.scale > 0)) {
    return fail('The transform scale must be a number greater than zero.')
  }

  const bounds = raw.bounds as Record<string, unknown> | undefined
  if (!bounds || !isVec3(bounds.min) || !isVec3(bounds.max)) {
    return fail('The Location bounds must be { min: [x, y, z], max: [x, y, z] }.')
  }
  if (bounds.min.some((value, axis) => value > (bounds.max as Vec3)[axis])) {
    return fail('The Location bounds are inverted: every min must be less than or equal to its max.')
  }

  const source = raw.source as Record<string, unknown> | undefined
  if (!source || typeof source !== 'object') {
    return fail('The Location sidecar is missing its source description.')
  }
  if (!SIDECAR_SOURCE_FORMATS.includes(source.format as SidecarSourceFormat)) {
    return fail(
      `Unknown source format ${String(source.format)}. Expected one of: ${SIDECAR_SOURCE_FORMATS.join(', ')}.`,
    )
  }
  if (typeof source.byteSize !== 'number' || !(source.byteSize > 0)) {
    return fail('The source byteSize must be a number greater than zero.')
  }
  if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(source.sha256)) {
    return fail('The source sha256 must be 64 hexadecimal characters.')
  }

  const sidecar = raw as unknown as LocationSidecar

  // a published revision is immutable, so a checksum that no longer matches its
  // content means the file was edited after publication
  if (typeof sidecar.checksum === 'string') {
    const expected = sidecarChecksum(sidecar)
    if (sidecar.checksum !== expected) {
      return fail(
        `Location sidecar revision "${sidecar.revision}" has been modified since it was published (checksum ${sidecar.checksum} does not match its contents). Re-ingest the Location.`,
      )
    }
  }

  return { ok: true, sidecar }
}

// ---------------------------------------------------------------------------
// What the runtime asks of it
// ---------------------------------------------------------------------------

/** Z-up capture -> Y-up runtime is a -90 degree turn about X. */
const UP_AXIS_CORRECTION: Record<LocationSidecar['upAxis'], Vec3> = {
  y: [0, 0, 0],
  z: [-90, 0, 0],
}

/**
 * The transform StageHost should apply: the authored transform with the up-axis
 * correction folded in, so no dataset needs a hand-written rotation.
 */
export function locationTransform(sidecar: LocationSidecar): {
  position: Vec3
  eulerDegrees: Vec3
  scale: number
} {
  const correction = UP_AXIS_CORRECTION[sidecar.upAxis]
  const authored = sidecar.transform.eulerDegrees
  return {
    position: [...sidecar.transform.position] as Vec3,
    eulerDegrees: [
      correction[0] + authored[0],
      correction[1] + authored[1],
      correction[2] + authored[2],
    ],
    scale: sidecar.transform.scale,
  }
}

/** Where to put a camera so the whole Location is in frame. */
export function frameFromBounds(bounds: SidecarBounds): {
  center: Vec3
  radius: number
  distance: number
} {
  const center: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ]
  const span: Vec3 = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ]
  const radius = Math.max(0.5, Math.hypot(span[0], span[1], span[2]) / 2)
  return { center, radius, distance: radius * 2.4 + 1 }
}
