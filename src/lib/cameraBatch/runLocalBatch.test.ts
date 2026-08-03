import { describe, expect, it } from 'vitest'
import { profileToPreset } from './runLocalBatch'

describe('camera batch profiles', () => {
  it('maps planned shot profiles onto existing camera presets', () => {
    expect(profileToPreset('packshot')).toBe('orbit')
    expect(profileToPreset('reveal-orbit')).toBe('orbit')
    expect(profileToPreset('dolly')).toBe('dolly')
    expect(profileToPreset('fpv-drone')).toBe('flyover')
    expect(profileToPreset('custom')).toBe('arc')
  })
})
