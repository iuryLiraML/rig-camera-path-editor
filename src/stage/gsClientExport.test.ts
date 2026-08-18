import { describe, expect, it } from 'vitest'
import {
  encodeProgressFraction,
  exportFrameTimes,
  totalExportFrames,
  warmPathTimeoutUserMessage,
} from './gsClientExport'
import { avcCodecString, evenExportDim, frameTimingUs, isKeyframe } from '../lib/mp4Encode'

describe('totalExportFrames', () => {
  it('rounds duration × fps and keeps at least 2 frames', () => {
    expect(totalExportFrames(6, 24)).toBe(144)
    expect(totalExportFrames(0, 24)).toBe(2)
  })
})

describe('exportFrameTimes', () => {
  it('returns inclusive 0..1 samples', () => {
    expect(exportFrameTimes(5)).toEqual([0, 0.25, 0.5, 0.75, 1])
  })
})

describe('encodeProgressFraction', () => {
  it('stays within the encode band after warm', () => {
    expect(encodeProgressFraction(0, 100)).toBeCloseTo(0.1)
    expect(encodeProgressFraction(100, 100)).toBeCloseTo(0.95)
    expect(encodeProgressFraction(50, 100)).toBeCloseTo(0.525)
  })
})

describe('mp4Encode helpers', () => {
  it('picks AVC levels from coded area', () => {
    expect(avcCodecString(1280, 720)).toBe('avc1.4d001f')
    expect(avcCodecString(1920, 1080)).toBe('avc1.4d002a')
  })

  it('computes microsecond frame timing', () => {
    expect(frameTimingUs(0, 24)).toEqual({ timestamp: 0, duration: Math.round(1e6 / 24) })
    expect(frameTimingUs(24, 24).timestamp).toBe(1_000_000)
  })

  it('marks keyframes every 2s', () => {
    expect(isKeyframe(0, 24)).toBe(true)
    expect(isKeyframe(48, 24)).toBe(true)
    expect(isKeyframe(1, 24)).toBe(false)
  })

  it('evenExportDim clamps and rounds', () => {
    expect(evenExportDim(1281)).toBe(1280)
    expect(evenExportDim(8)).toBe(16)
  })
})

describe('warmPathTimeoutUserMessage', () => {
  it('mentions cloud fallback later', () => {
    const msg = warmPathTimeoutUserMessage(20_000)
    expect(msg).toContain('20000')
    expect(msg.toLowerCase()).toContain('cloud')
  })
})
