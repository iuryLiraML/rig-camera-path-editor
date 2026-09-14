import { describe, expect, it } from 'vitest'
import { directorIsCompact, isPhoneTier, layoutTier } from './chromeLayout'

describe('layoutTier', () => {
  it('is full only at desktop width with room to spare', () => {
    expect(layoutTier(1024, 700)).toBe('full')
    expect(layoutTier(1366, 768)).toBe('full')
    expect(layoutTier(1920, 1080)).toBe('full')
    expect(layoutTier(2560, 1440)).toBe('full')
  })

  it('is compact in the short desktop band (netbook)', () => {
    expect(layoutTier(1024, 600)).toBe('compact')
    expect(layoutTier(1024, 699)).toBe('compact')
  })

  it('is tablet for iPad-class and narrow desktop windows', () => {
    expect(layoutTier(768, 1024)).toBe('tablet')
    expect(layoutTier(900, 700)).toBe('tablet')
    expect(layoutTier(800, 640)).toBe('tablet')
    expect(layoutTier(1023, 900)).toBe('tablet')
  })

  it('is phone for narrow portrait and short landscape phones', () => {
    expect(layoutTier(360, 800)).toBe('phone')
    expect(layoutTier(390, 844)).toBe('phone')
    expect(layoutTier(844, 390)).toBe('phone') // landscape phone — short height wins
    expect(layoutTier(599, 900)).toBe('phone')
  })

  it('never reports a viewport as unsupported', () => {
    for (const [w, h] of [
      [360, 800],
      [390, 844],
      [844, 390],
      [768, 1024],
      [1024, 768],
      [1024, 600],
      [1366, 768],
      [1440, 900],
      [1920, 1080],
      [2560, 1440],
    ] as const) {
      expect(['phone', 'tablet', 'compact', 'full']).toContain(layoutTier(w, h))
    }
  })

  it('classifies only the phone tier as sheet-based', () => {
    expect(isPhoneTier(layoutTier(360, 800))).toBe(true)
    expect(isPhoneTier(layoutTier(844, 390))).toBe(true)
    expect(isPhoneTier(layoutTier(768, 1024))).toBe(false)
    expect(isPhoneTier(layoutTier(1440, 900))).toBe(false)
  })
})

describe('directorIsCompact', () => {
  it('defaults to expanded on a full desktop and compact below full', () => {
    expect(directorIsCompact(1280, 800, 'auto')).toBe(false)
    expect(directorIsCompact(900, 700, 'auto')).toBe(true) // tablet
    expect(directorIsCompact(360, 800, 'auto')).toBe(true) // phone
  })

  it('is compact at 1024×600 even when preference is expanded', () => {
    expect(directorIsCompact(1024, 600, 'expanded')).toBe(true)
    expect(directorIsCompact(1024, 600, 'auto')).toBe(true)
  })

  it('lets persisted expanded win only on a full layout', () => {
    expect(directorIsCompact(1280, 800, 'compact')).toBe(true)
    expect(directorIsCompact(1024, 700, 'expanded')).toBe(false)
    expect(directorIsCompact(900, 700, 'expanded')).toBe(true) // tablet
    expect(directorIsCompact(700, 800, 'expanded')).toBe(true) // phone
  })
})
