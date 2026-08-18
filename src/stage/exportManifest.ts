/**
 * ExportManifest — frozen quality + residency contract (ARCHITECTURE-GS §5).
 * Shared by client scrub/export and (later) the cloud export worker.
 */

import { DEMO_SPLAT_BUDGET } from './demoConfig'
import {
  DEFAULT_SHOT_DURATION_S,
  warmPathSampleCount,
} from './pathOverlayMath'

export type ExportAssetVersion = {
  spaceId: string
  assetId: string
  version: number
}

export type ExportManifest = {
  /** Device/stream Gaussian budget used for this export */
  gaussianBudget: number
  /**
   * Coarsest allowed LOD index to hold (PlayCanvas LOD: 0 = finest).
   * StageHost pins both `lodRangeMin` and `lodRangeMax` to this value when
   * Locked quality is on, so opportunistic refine cannot change residency mid-scrub.
   */
  maxLod: number
  /** Path samples (t in 0..1) used to compute required chunk set */
  pathSamples: number[]
  /** Fail client export if warmPath exceeds this (ms) → cloud fallback */
  warmTimeoutMs: number
  width: number
  height: number
  fps: number
  /** Same IDs/versions the cloud worker must load from S3 (no hotlink) */
  assetVersions: ExportAssetVersion[]
}

/** Interactive scrub: higher underfill, soft budget — not WYSIWYG with export. */
export const PREVIEW_SPLAT_BUDGET = DEMO_SPLAT_BUDGET

/** Locked / export default on the demo Location (calibrate after more spikes). */
export const LOCKED_SPLAT_BUDGET = 2_500_000

/** PlayCanvas LOD pin for Locked quality on the demo SOG (0 = finest). */
export const LOCKED_MAX_LOD = 1

export const DEFAULT_WARM_TIMEOUT_MS = 20_000

export type QualityMode = 'preview' | 'locked'

/** Evenly spaced t ∈ [0, 1], inclusive. Count must be ≥ 2. */
export function samplePathTimes(count: number): number[] {
  const n = Math.max(2, Math.floor(count))
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(i / (n - 1))
  }
  return out
}

export type DemoExportManifestOptions = {
  gaussianBudget?: number
  maxLod?: number
  pathSampleCount?: number
  pathSamples?: number[]
  /** When set (and pathSampleCount/pathSamples omitted), densifies warm samples for longer shots. */
  durationS?: number
  warmTimeoutMs?: number
  width?: number
  height?: number
  fps?: number
  assetVersions?: ExportAssetVersion[]
}

/** Build a demo-stage ExportManifest for the StageHost quality-pin spike. */
export function createDemoExportManifest(
  options: DemoExportManifestOptions = {},
): ExportManifest {
  const pathSamples =
    options.pathSamples ??
    samplePathTimes(
      options.pathSampleCount ??
        warmPathSampleCount(options.durationS ?? DEFAULT_SHOT_DURATION_S),
    )
  return {
    gaussianBudget: options.gaussianBudget ?? LOCKED_SPLAT_BUDGET,
    maxLod: options.maxLod ?? LOCKED_MAX_LOD,
    pathSamples,
    warmTimeoutMs: options.warmTimeoutMs ?? DEFAULT_WARM_TIMEOUT_MS,
    width: options.width ?? 1280,
    height: options.height ?? 720,
    fps: options.fps ?? 24,
    assetVersions: options.assetVersions ?? [
      { spaceId: 'demo', assetId: 'roman-parish-streamed-sog', version: 1 },
    ],
  }
}
