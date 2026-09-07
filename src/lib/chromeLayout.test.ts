import { describe, expect, it } from 'vitest'
import { directorIsCompact, layoutTier } from './chromeLayout'

describe('layoutTier', () => {
  it('is full at 1024×700 and compact in the laptop band', () => {
    expect(layoutTier(1024, 700)).toBe('full')
    expect(layoutTier(900, 700)).toBe('compact')
    expect(layoutTier(800, 640)).toBe('compact')
    expect(layoutTier(1024, 600)).toBe('compact')
    expect(layoutTier(1024, 699)).toBe('compact')
  })

  it('is unsupported below 768×600', () => {
    expect(layoutTier(767, 800)).toBe('unsupported')
    expect(layoutTier(900, 599)).toBe('unsupported')
  })
})

describe('directorIsCompact', () => {
  it('defaults to expanded on a full desktop and compact below 1024', () => {
    expect(directorIsCompact(1280, 800, 'auto')).toBe(false)
    expect(directorIsCompact(900, 700, 'auto')).toBe(true)
  })

  it('is compact at 1024×600 even when preference is expanded', () => {
    expect(directorIsCompact(1024, 600, 'expanded')).toBe(true)
    expect(directorIsCompact(1024, 600, 'auto')).toBe(true)
  })

  it('lets persisted expanded win only on a full layout', () => {
    expect(directorIsCompact(1280, 800, 'compact')).toBe(true)
    expect(directorIsCompact(1024, 700, 'expanded')).toBe(false)
    expect(directorIsCompact(900, 700, 'expanded')).toBe(true)
    expect(directorIsCompact(700, 800, 'expanded')).toBe(true)
  })
})
