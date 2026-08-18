import { describe, expect, it } from 'vitest'
import {
  avcCodecString,
  avcLevelFromCodedArea,
  evenExportDim,
  frameTimingUs,
  isKeyframe,
} from './mp4Encode'

describe('avcLevelFromCodedArea', () => {
  it('maps common export sizes', () => {
    expect(avcLevelFromCodedArea(1280, 720)).toBe('1f')
    expect(avcLevelFromCodedArea(1920, 1080)).toBe('2a')
    expect(avcCodecString(1280, 720)).toBe('avc1.4d001f')
  })
})

describe('frameTimingUs', () => {
  it('uses microseconds', () => {
    expect(frameTimingUs(2, 30)).toEqual({
      timestamp: Math.round((2 * 1e6) / 30),
      duration: Math.round(1e6 / 30),
    })
  })
})

describe('isKeyframe', () => {
  it('is true every intervalSec × fps', () => {
    expect(isKeyframe(0, 30)).toBe(true)
    expect(isKeyframe(60, 30)).toBe(true)
    expect(isKeyframe(3, 30)).toBe(false)
  })
})

describe('evenExportDim', () => {
  it('returns even values in range', () => {
    expect(evenExportDim(100.9)).toBe(100)
    expect(evenExportDim(1)).toBe(16)
  })
})
