import * as THREE from 'three'
import type { Vec3 } from '../state/useSceneStore'
import type { EaseKind } from './easing'
import { evalValue, type ValueKey } from './keyframes'

export type CameraNoiseKeys = {
  intensityKeys?: ValueKey[]
  fadeInKeys?: ValueKey[]
  fadeOutKeys?: ValueKey[]
  ampPosKeys?: ValueKey[]
  ampRotKeys?: ValueKey[]
  freqKeys?: ValueKey[]
}

/** Static clip + keyed overrides, still a pure function of t. */
export function resolveCameraNoiseAt(
  t: number,
  noise: CameraNoise,
  keys: CameraNoiseKeys,
  ease: EaseKind,
): CameraNoise {
  return {
    ...noise,
    intensity: evalValue(t, keys.intensityKeys ?? [], noise.intensity, ease),
    fadeIn: evalValue(t, keys.fadeInKeys ?? [], noise.fadeIn, ease),
    fadeOut: evalValue(t, keys.fadeOutKeys ?? [], noise.fadeOut, ease),
    ampPos: evalValue(t, keys.ampPosKeys ?? [], noise.ampPos, ease),
    ampRot: evalValue(t, keys.ampRotKeys ?? [], noise.ampRot, ease),
    freq: evalValue(t, keys.freqKeys ?? [], noise.freq, ease),
  }
}

type PoseBasis = {
  position: Vec3
  quaternion: [number, number, number, number]
}

export type NoiseStyle = 'shake' | 'handheld' | 'rumble'

export type CameraNoise = {
  enabled: boolean
  style: NoiseStyle
  /** Master gain 0..1, after the style profile */
  intensity: number
  /** Window start as 0..1 of the shot */
  start: number
  /** Window end as 0..1 of the shot */
  end: number
  /** Fade-in length in seconds */
  fadeIn: number
  /** Fade-out length in seconds */
  fadeOut: number
  /** Position jitter override (world units). Initialized from the style table. */
  ampPos: number
  /** Rotation jitter override (degrees). */
  ampRot: number
  /** Frequency override. */
  freq: number
  seed: number
}

export const NOISE_STYLES: Record<NoiseStyle, { ampPos: number; ampRot: number; freq: number }> = {
  shake: { ampPos: 0.03, ampRot: 0.8, freq: 3 },
  handheld: { ampPos: 0.015, ampRot: 1.6, freq: 1.2 },
  rumble: { ampPos: 0.08, ampRot: 0.35, freq: 0.8 },
}

export const DEFAULT_CAMERA_NOISE: CameraNoise = {
  enabled: false,
  style: 'shake',
  intensity: 1,
  start: 0,
  end: 1,
  fadeIn: 0,
  fadeOut: 0,
  ...NOISE_STYLES.shake,
  seed: 1,
}

export function styleAmps(style: NoiseStyle) {
  return NOISE_STYLES[style]
}

export function normalizeCameraNoise(partial: Partial<CameraNoise> | undefined): CameraNoise {
  return { ...DEFAULT_CAMERA_NOISE, ...partial }
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}

/**
 * 0 outside [start, end]; 1 in the middle when fades are 0.
 * fadeIn / fadeOut are seconds, converted with the shot duration.
 */
export function noiseGain(t: number, noise: CameraNoise, duration: number): number {
  if (!noise.enabled) return 0
  const start = clamp01(Math.min(noise.start, noise.end))
  const end = clamp01(Math.max(noise.start, noise.end))
  if (t < start || t > end) return 0
  const dur = Math.max(duration, 1e-6)
  const fadeInT = Math.max(0, noise.fadeIn) / dur
  const fadeOutT = Math.max(0, noise.fadeOut) / dur
  let gain = 1
  if (fadeInT > 1e-8 && t < start + fadeInT) {
    gain = Math.min(gain, (t - start) / fadeInT)
  }
  if (fadeOutT > 1e-8 && t > end - fadeOutT) {
    gain = Math.min(gain, (end - t) / fadeOutT)
  }
  return clamp01(gain)
}

/** Deterministic value-noise in [-1, 1]. Same (t, seed, freq) always matches. */
export function valueNoise1(t: number, seed: number, freq: number): number {
  const x = t * Math.max(0, freq)
  const i = Math.floor(x)
  const f = x - i
  const a = hash01(i, seed)
  const b = hash01(i + 1, seed)
  const u = f * f * (3 - 2 * f)
  return (a + (b - a) * u) * 2 - 1
}

function hash01(i: number, seed: number): number {
  const n = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function sampleAxis(t: number, seed: number, freq: number, style: NoiseStyle): number {
  const a = valueNoise1(t, seed, freq)
  if (style !== 'handheld') return a
  return a * 0.55 + valueNoise1(t, seed + 8, freq * 0.45) * 0.45
}

const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _delta = new THREE.Quaternion()
const _euler = new THREE.Euler()

/**
 * Overlay shake after the authored pose. Pure in t — preview and export match.
 */
export function applyCameraNoise<T extends PoseBasis>(
  pose: T,
  t: number,
  noise: CameraNoise,
  duration = 6,
): T {
  const gain = noiseGain(t, noise, duration) * clamp01(noise.intensity)
  if (gain <= 0) return pose

  const freq = Math.max(0, noise.freq)
  const n0 = sampleAxis(t, noise.seed, freq, noise.style)
  const n1 = sampleAxis(t, noise.seed + 17, freq, noise.style)
  const n2 = sampleAxis(t, noise.seed + 31, freq * 0.85, noise.style)

  _quat.set(...pose.quaternion)
  _right.set(1, 0, 0).applyQuaternion(_quat)
  _up.set(0, 1, 0).applyQuaternion(_quat)
  _pos.set(...pose.position)
  _pos.addScaledVector(_right, n0 * noise.ampPos * gain)
  _pos.addScaledVector(_up, n1 * noise.ampPos * gain)

  const rad = THREE.MathUtils.DEG2RAD * noise.ampRot * gain
  _euler.set(n1 * rad, n0 * rad, n2 * rad, 'YXZ')
  _delta.setFromEuler(_euler)
  _quat.multiply(_delta)

  return {
    ...pose,
    position: [_pos.x, _pos.y, _pos.z],
    quaternion: [_quat.x, _quat.y, _quat.z, _quat.w],
  }
}
