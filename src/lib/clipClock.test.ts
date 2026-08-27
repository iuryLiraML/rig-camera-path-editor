import { describe, expect, it } from 'vitest'
import { clipPlayheadSeconds } from './clipClock'

describe('clipPlayheadSeconds', () => {
  const clips = [
    { name: 'Idle', duration: 2 },
    { name: 'Walk', duration: 1 },
    { name: 'Run', duration: 0.6 },
  ]

  it('loops the active clip, not the longest clip in the mixer', () => {
    expect(clipPlayheadSeconds(0.5, 2, clips, 'Walk')).toBeCloseTo(0, 5)
    expect(clipPlayheadSeconds(0.25, 2, clips, 'Walk')).toBeCloseTo(0.5, 5)
    expect(clipPlayheadSeconds(0.5, 2, clips, 'Idle')).toBeCloseTo(1, 5)
  })
})
