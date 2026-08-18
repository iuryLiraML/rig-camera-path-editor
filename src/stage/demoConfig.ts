import {
  LOCATION_SIDECAR_FORMAT_VERSION,
  type LocationSidecar,
} from './locationSidecar'

/**
 * Demo Location for first-run — PlayCanvas Streamed SOG hosted by PlayCanvas.
 * Source: engine LOD streaming example (Roman Parish).
 */
export const DEMO_STREAMED_SOG_URL =
  'https://code.playcanvas.com/examples_data/example_roman_parish_02/lod-meta.json'

/**
 * The demo Location described the way ingest will describe every Location
 * (E1.4). The rotation used to live here as `eulerDegrees: [-90, 0, 0]` with a
 * comment guessing that the dataset is Z-up; now the up axis is the datum and
 * `locationTransform` derives the rotation, so the demo exercises the same code
 * path an ingested capture will.
 *
 * `bounds` is approximate — nobody measured this CDN dataset. It is only used for
 * framing fallbacks; the demo keeps the hand-picked framing below. An ingested
 * Location gets real bounds from the IngestWorker.
 */
export const DEMO_LOCATION_SIDECAR: LocationSidecar = {
  formatVersion: LOCATION_SIDECAR_FORMAT_VERSION,
  revision: 'demo-roman-parish-02',
  units: 'meters',
  upAxis: 'z',
  transform: { position: [0, 0, 0], eulerDegrees: [0, 0, 0], scale: 1 },
  bounds: { min: [-4, 0, -16], max: [28, 12, 16] },
  source: { format: 'streamed-sog', byteSize: 1, sha256: '0'.repeat(64) },
}

export const DEMO_LOCATION = {
  name: 'Roman Parish (demo)',
  url: DEMO_STREAMED_SOG_URL,
  sidecar: DEMO_LOCATION_SIDECAR,
  /** Hand-picked for this one dataset: a human framing choice, not sidecar data. */
  cameraPosition: [10.3, 2, -10] as [number, number, number],
  focusPoint: [12, 3, 0] as [number, number, number],
}

/** Shared Gaussian budget for the spike (desktop-ish). */
export const DEMO_SPLAT_BUDGET = 4_000_000
