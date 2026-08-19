/**
 * Focal-length presets for the Compose camera bar.
 * three.js PerspectiveCamera.fov is vertical; we map through a 24 mm
 * full-frame sensor height so 35 mm lands near the default 45° FOV.
 */

export const SENSOR_HEIGHT_MM = 24

export const LENS_PRESETS = [
  { mm: 14, label: '14mm Ultra-Wide' },
  { mm: 24, label: '24mm Wide' },
  { mm: 35, label: '35mm Standard' },
  { mm: 70, label: '70mm Portrait' },
  { mm: 100, label: '100mm Telephoto' },
  { mm: 200, label: '200mm Super Telephoto' },
] as const

export type LensPresetMm = (typeof LENS_PRESETS)[number]['mm']

export function fovFromFocalLength(mm: number, sensorHeightMm = SENSOR_HEIGHT_MM): number {
  const focal = Math.max(1, mm)
  return (2 * Math.atan(sensorHeightMm / (2 * focal)) * 180) / Math.PI
}

export function focalLengthFromFov(fov: number, sensorHeightMm = SENSOR_HEIGHT_MM): number {
  const half = Math.max(0.5, Math.min(89, fov)) * (Math.PI / 360)
  return sensorHeightMm / (2 * Math.tan(half))
}

export function nearestLensPreset(fov: number): LensPresetMm {
  const mm = focalLengthFromFov(fov)
  let best: LensPresetMm = LENS_PRESETS[0].mm
  let bestDist = Infinity
  for (const preset of LENS_PRESETS) {
    const dist = Math.abs(preset.mm - mm)
    if (dist < bestDist) {
      best = preset.mm
      bestDist = dist
    }
  }
  return best
}
