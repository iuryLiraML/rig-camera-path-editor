import { describe, expect, it } from 'vitest'
import { hasKeyAtTime, resolveKeyTargets } from './keyAtPlayhead'
import { KEY_MERGE_EPS } from './keyframes'

describe('hasKeyAtTime', () => {
  it('hits a key inside the merge window', () => {
    expect(hasKeyAtTime([{ time: 0.5 }], 0.5 + KEY_MERGE_EPS / 2)).toBe(true)
  })

  it('misses a key outside the merge window', () => {
    expect(hasKeyAtTime([{ time: 0.5 }], 0.5 + KEY_MERGE_EPS + 0.001)).toBe(false)
  })
})

describe('resolveKeyTargets', () => {
  it('keys only the focused camera channel', () => {
    expect(resolveKeyTargets('fov', 'cinema-camera', ['progress', 'fov'])).toEqual({
      channels: ['fov'],
      object: false,
    })
  })

  it('keys FX amount when Amount is focused', () => {
    expect(resolveKeyTargets('intensity', 'cinema-camera', ['fov'])).toEqual({
      channels: ['intensity'],
      object: false,
    })
  })

  it('keys FX pos when Pos is focused', () => {
    expect(resolveKeyTargets('ampPos', 'cinema-camera', ['intensity'])).toEqual({
      channels: ['ampPos'],
      object: false,
    })
  })

  it('keys FX fade in when Fade in is focused', () => {
    expect(resolveKeyTargets('fadeIn', 'cinema-camera', ['intensity'])).toEqual({
      channels: ['fadeIn'],
      object: false,
    })
  })

  it('keys the object pose when an object is selected', () => {
    expect(resolveKeyTargets(null, 'obj:box-1', ['fov'])).toEqual({
      channels: [],
      object: true,
    })
  })

  it('keys already-animated camera channels when nothing is focused', () => {
    expect(resolveKeyTargets(null, 'cinema-camera', ['fov', 'roll'])).toEqual({
      channels: ['fov', 'roll'],
      object: false,
    })
  })

  it('falls back to path progress when the camera has no keys yet', () => {
    expect(resolveKeyTargets(null, 'camera-path', [])).toEqual({
      channels: ['progress'],
      object: false,
    })
  })
})
