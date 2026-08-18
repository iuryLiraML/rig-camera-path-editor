import { describe, expect, it } from 'vitest'
import { beginPlayback, playheadAtEnd, togglePlayback } from './playback'

describe('playback', () => {
  it('treats a playhead at the end as finished', () => {
    expect(playheadAtEnd(1)).toBe(true)
    expect(playheadAtEnd(0.999999)).toBe(true)
    expect(playheadAtEnd(0.99)).toBe(false)
  })

  it('rewinds before playing when the shot has already finished', () => {
    expect(beginPlayback(1)).toEqual({ t: 0, playing: true })
    expect(togglePlayback(1, false)).toEqual({ t: 0, playing: true })
  })

  it('resumes from the current time when the shot is mid-way', () => {
    expect(beginPlayback(0.4)).toEqual({ t: 0.4, playing: true })
    expect(togglePlayback(0.4, false)).toEqual({ t: 0.4, playing: true })
  })

  it('pauses without moving the playhead', () => {
    expect(togglePlayback(0.4, true)).toEqual({ t: 0.4, playing: false })
    expect(togglePlayback(1, true)).toEqual({ t: 1, playing: false })
  })
})
