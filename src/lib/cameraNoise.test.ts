import { describe, expect, it } from 'vitest'
import {
  applyCameraNoise,
  DEFAULT_CAMERA_NOISE,
  noiseGain,
  resolveCameraNoiseAt,
  styleAmps,
  valueNoise1,
} from './cameraNoise'

function pose() {
  return {
    position: [0, 1, 4] as [number, number, number],
    quaternion: [0, 0, 0, 1] as [number, number, number, number],
    fov: 45,
    lookTarget: [0, 1, 0],
    tangent: [0, 0, -1],
    pathU: 0.4,
  }
}

const on = { ...DEFAULT_CAMERA_NOISE, enabled: true }

describe('valueNoise1', () => {
  it('is a pure function of t, seed and freq', () => {
    expect(valueNoise1(0.33, 2, 4)).toBe(valueNoise1(0.33, 2, 4))
  })

  it('stays in [-1, 1]', () => {
    for (let i = 0; i <= 20; i++) {
      const n = valueNoise1(i / 20, 3, 5)
      expect(n).toBeGreaterThanOrEqual(-1)
      expect(n).toBeLessThanOrEqual(1)
    }
  })
})

describe('noiseGain', () => {
  it('is 0 before start and after end', () => {
    const noise = { ...on, start: 0.4, end: 0.7, fadeIn: 0, fadeOut: 0 }
    expect(noiseGain(0.2, noise, 6)).toBe(0)
    expect(noiseGain(0.9, noise, 6)).toBe(0)
  })

  it('is 1 in the middle when fades are 0', () => {
    const noise = { ...on, start: 0.2, end: 0.8, fadeIn: 0, fadeOut: 0 }
    expect(noiseGain(0.5, noise, 6)).toBe(1)
  })

  it('ramps continuously through a fade-in', () => {
    const noise = { ...on, start: 0, end: 1, fadeIn: 2, fadeOut: 0 }
    const mid = noiseGain(1 / 6, noise, 6)
    expect(mid).toBeCloseTo(0.5, 5)
    const coarse = Math.abs(noiseGain(0.2 / 6, noise, 6) - noiseGain(0 / 6, noise, 6))
    const fine = Math.abs(noiseGain(0.05 / 6, noise, 6) - noiseGain(0 / 6, noise, 6))
    expect(fine).toBeLessThan(coarse)
  })

  it('is 0 while disabled', () => {
    expect(noiseGain(0.5, DEFAULT_CAMERA_NOISE, 6)).toBe(0)
  })
})

describe('styleAmps', () => {
  it('gives handheld more rotation and less position than shake', () => {
    expect(styleAmps('handheld').ampRot).toBeGreaterThan(styleAmps('shake').ampRot)
    expect(styleAmps('handheld').ampPos).toBeLessThan(styleAmps('shake').ampPos)
  })

  it('gives rumble more position and less frequency than shake', () => {
    expect(styleAmps('rumble').ampPos).toBeGreaterThan(styleAmps('shake').ampPos)
    expect(styleAmps('rumble').freq).toBeLessThan(styleAmps('shake').freq)
  })
})

describe('applyCameraNoise', () => {
  it('is a no-op while disabled', () => {
    const src = pose()
    expect(applyCameraNoise(src, 0.4, DEFAULT_CAMERA_NOISE, 6)).toEqual(src)
  })

  it('is a no-op outside the window', () => {
    const src = pose()
    const noise = { ...on, start: 0.6, end: 1 }
    expect(applyCameraNoise(src, 0.2, noise, 6)).toEqual(src)
  })

  it('offsets the pose the same way on a second call', () => {
    const a = applyCameraNoise(pose(), 0.4, on, 6)
    const b = applyCameraNoise(pose(), 0.4, on, 6)
    expect(a.position).toEqual(b.position)
    expect(a.quaternion).toEqual(b.quaternion)
    expect(a.position).not.toEqual(pose().position)
  })
})

describe('resolveCameraNoiseAt', () => {
  it('interpolates ampPos keys the same way intensity keys interpolate amount', () => {
    const noise = { ...on, ampPos: 0.02 }
    const keys = {
      ampPosKeys: [
        { id: 'p0', time: 0, value: 0 },
        { id: 'p1', time: 1, value: 0.2 },
      ],
    }
    expect(resolveCameraNoiseAt(0, noise, keys, 'linear').ampPos).toBeCloseTo(0, 5)
    expect(resolveCameraNoiseAt(0.5, noise, keys, 'linear').ampPos).toBeCloseTo(0.1, 5)
    expect(resolveCameraNoiseAt(1, noise, keys, 'linear').ampPos).toBeCloseTo(0.2, 5)
  })

  it('interpolates fadeIn keys independently of the clip window', () => {
    const noise = { ...on, fadeIn: 0.4 }
    const keys = {
      fadeInKeys: [
        { id: 'f0', time: 0, value: 0 },
        { id: 'f1', time: 1, value: 1.2 },
      ],
    }
    expect(resolveCameraNoiseAt(0, noise, keys, 'linear').fadeIn).toBeCloseTo(0, 5)
    expect(resolveCameraNoiseAt(0.5, noise, keys, 'linear').fadeIn).toBeCloseTo(0.6, 5)
    expect(resolveCameraNoiseAt(1, noise, keys, 'linear').fadeIn).toBeCloseTo(1.2, 5)
  })
})
