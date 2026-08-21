import { describe, expect, it } from 'vitest'
import { findKeyAtTime, hasKeyAtTime, resolveKeyTargets } from './keyAtPlayhead'
import { KEY_MERGE_EPS } from './keyframes'

describe('hasKeyAtTime', () => {
  it('hits a key inside the merge window', () => {
    expect(hasKeyAtTime([{ time: 0.5 }], 0.5 + KEY_MERGE_EPS / 2)).toBe(true)
  })

  it('misses a key outside the merge window', () => {
    expect(hasKeyAtTime([{ time: 0.5 }], 0.5 + KEY_MERGE_EPS + 0.001)).toBe(false)
  })

  it('returns the matching key', () => {
    const keys = [
      { id: 'a', time: 0.1 },
      { id: 'b', time: 0.5 },
    ]
    expect(findKeyAtTime(keys, 0.5)?.id).toBe('b')
    expect(findKeyAtTime(keys, 0.9)).toBeUndefined()
  })
})

describe('resolveKeyTargets', () => {
  it('keys only the focused camera channel', () => {
    expect(resolveKeyTargets('fov', 'cinema-camera', ['progress', 'fov'])).toEqual({
      channels: ['fov'],
      object: false,
      objectChannels: [],
    })
  })

  it('keys FX amount when Amount is focused', () => {
    expect(resolveKeyTargets('intensity', 'cinema-camera', ['fov'])).toEqual({
      channels: ['intensity'],
      object: false,
      objectChannels: [],
    })
  })

  it('keys FX pos when Pos is focused', () => {
    expect(resolveKeyTargets('ampPos', 'cinema-camera', ['intensity'])).toEqual({
      channels: ['ampPos'],
      object: false,
      objectChannels: [],
    })
  })

  it('keys FX fade in when Fade in is focused', () => {
    expect(resolveKeyTargets('fadeIn', 'cinema-camera', ['intensity'])).toEqual({
      channels: ['fadeIn'],
      object: false,
      objectChannels: [],
    })
  })

  it('keys all transform channels when an object is selected', () => {
    expect(resolveKeyTargets(null, 'obj:box-1', ['fov'])).toEqual({
      channels: [],
      object: true,
      objectChannels: ['position', 'rotation', 'scale'],
    })
  })

  it('keys only position when Position is focused', () => {
    expect(resolveKeyTargets('objectPosition', 'obj:box-1', ['fov'])).toEqual({
      channels: [],
      object: true,
      objectChannels: ['position'],
    })
  })

  it('keys already-animated camera channels when nothing is focused', () => {
    expect(resolveKeyTargets(null, 'cinema-camera', ['fov', 'roll'])).toEqual({
      channels: ['fov', 'roll'],
      object: false,
      objectChannels: [],
    })
  })

  it('falls back to path progress when the camera has no keys yet', () => {
    expect(resolveKeyTargets(null, 'camera-path', [])).toEqual({
      channels: ['progress'],
      object: false,
      objectChannels: [],
    })
  })
})
