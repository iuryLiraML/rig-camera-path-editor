import { describe, expect, it } from 'vitest'
import {
  formatGraphValue,
  graphValueTicks,
  laneYToValue,
  plotRange,
  RANGE_FOV,
  RANGE_PROGRESS,
  valueToLaneY,
} from './lanePlot'

describe('lanePlot', () => {
  it('maps the bottom of the padded lane to the range floor', () => {
    expect(laneYToValue(valueToLaneY(20, RANGE_FOV), RANGE_FOV)).toBeCloseTo(20, 5)
    expect(laneYToValue(valueToLaneY(90, RANGE_FOV), RANGE_FOV)).toBeCloseTo(90, 5)
  })

  it('expands the default range to include keyed values', () => {
    const range = plotRange([12, 110], RANGE_FOV)
    expect(range.lo).toBe(12)
    expect(range.hi).toBe(110)
  })

  it('keeps the default range when values sit inside it', () => {
    const range = plotRange([45, 50], RANGE_FOV)
    expect(range.lo).toBe(RANGE_FOV.lo)
    expect(range.hi).toBe(RANGE_FOV.hi)
  })

  it('labels graph ticks in the channel unit', () => {
    expect(formatGraphValue('percent', 0.5)).toBe('50%')
    expect(formatGraphValue('degrees', 42.2)).toBe('42°')
    expect(graphValueTicks(RANGE_PROGRESS, 3)).toEqual([0, 0.5, 1])
  })
})
