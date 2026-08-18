import { describe, expect, it } from 'vitest'
import {
  NUMBER_SCRUB_PX_PER_STEP,
  numberScrubScale,
  numberScrubValue,
} from './numberScrub'

describe('numberScrubScale', () => {
  it('is 1× with no modifiers', () => {
    expect(numberScrubScale(false, false)).toBe(1)
  })

  it('is 0.1× with Shift, even if Alt is also down', () => {
    expect(numberScrubScale(true, false)).toBe(0.1)
    expect(numberScrubScale(true, true)).toBe(0.1)
  })

  it('is 10× with Alt alone', () => {
    expect(numberScrubScale(false, true)).toBe(10)
  })
})

describe('numberScrubValue', () => {
  it('increases when the pointer moves up', () => {
    expect(numberScrubValue(1, -NUMBER_SCRUB_PX_PER_STEP, 0.1, 1)).toBe(1.1)
  })

  it('decreases when the pointer moves down', () => {
    expect(numberScrubValue(1, NUMBER_SCRUB_PX_PER_STEP, 0.1, 1)).toBe(0.9)
  })

  it('stays put until a full step', () => {
    expect(numberScrubValue(1, -3, 0.1, 1)).toBe(1)
  })

  it('applies Shift as a finer step from the same origin', () => {
    expect(numberScrubValue(1, -NUMBER_SCRUB_PX_PER_STEP, 0.1, 0.1)).toBe(1.01)
  })

  it('applies Alt as a coarser step from the same origin', () => {
    expect(numberScrubValue(1, -NUMBER_SCRUB_PX_PER_STEP, 0.1, 10)).toBe(2)
  })

  it('does not accumulate float noise on a 0.1 field', () => {
    expect(numberScrubValue(0, -NUMBER_SCRUB_PX_PER_STEP * 3, 0.1, 1)).toBe(0.3)
  })
})
