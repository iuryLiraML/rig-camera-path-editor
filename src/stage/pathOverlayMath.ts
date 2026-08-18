/**
 * Pure helpers for GS path editor overlays and duration-linked warm sampling.
 */

import { buildCurve } from '../lib/curve'
import type { CinemaPathInput } from '../lib/evaluateCinemaPose'
import type { Vec3 } from '../state/useSceneStore'

/** Default shot length (seconds) — matches the R3F editor default. */
export const DEFAULT_SHOT_DURATION_S = 6
export const MIN_SHOT_DURATION_S = 1
export const MAX_SHOT_DURATION_S = 30

/** Curve points per path corner for the editor polyline (matches clay PathEditor density). */
export const PATH_POLYLINE_SEGMENTS_PER_ANCHOR = 24

/** Clamp shot duration into the editor range; non-finite → default. */
export function clampShotDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_SHOT_DURATION_S
  return Math.min(MAX_SHOT_DURATION_S, Math.max(MIN_SHOT_DURATION_S, seconds))
}

/**
 * Sample the Bézier path as a polyline for editor visualization.
 * With fewer than 2 anchors returns the raw corner positions (0–1 points).
 */
export function samplePathPolyline(
  path: CinemaPathInput,
  segmentsPerAnchor = PATH_POLYLINE_SEGMENTS_PER_ANCHOR,
): Vec3[] {
  const anchors = path.anchors
  if (anchors.length === 0) return []
  if (anchors.length === 1) return [anchors[0]!.position]

  const curve = buildCurve(anchors, path.closed ?? false, path.rounding ?? 0.8)
  if (!curve) return anchors.map((a) => a.position)

  const divisions = Math.max(64, anchors.length * Math.max(1, Math.floor(segmentsPerAnchor)))
  const points = curve.getPoints(divisions)
  return points.map((p) => [p.x, p.y, p.z] as Vec3)
}

/**
 * Warm-path sample count scales mildly with duration so longer shots keep
 * denser residency coverage. 6s → 9 samples (current ExportManifest default).
 */
export function warmPathSampleCount(durationS: number): number {
  const d = clampShotDuration(durationS)
  return Math.min(25, Math.max(9, Math.round(d * 1.5)))
}
