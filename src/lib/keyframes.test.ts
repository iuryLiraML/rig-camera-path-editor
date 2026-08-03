import { describe, expect, it } from 'vitest'
import { evalProgress, evalValue, evalVec3, type ProgressKey, type ValueKey } from './keyframes'
import { applyEase } from './easing'
import type { Vec3 } from '../state/useSceneStore'

const key = (time: number, value: number, ease?: ValueKey['ease']): ValueKey => ({
  id: `k${time}`,
  time,
  value,
  ease,
})

describe('evalValue', () => {
  it('returns the static value while a channel has no keyframes', () => {
    // this is what makes the first ◆ the moment a property becomes animated
    expect(evalValue(0.5, [], 45, 'linear')).toBe(45)
  })

  it('holds the first and last keyframe outside their range', () => {
    const keys = [key(0.25, 20), key(0.75, 60)]
    expect(evalValue(0, keys, 45, 'linear')).toBe(20)
    expect(evalValue(1, keys, 45, 'linear')).toBe(60)
  })

  it('interpolates with the default curve', () => {
    const keys = [key(0, 0), key(1, 100)]
    expect(evalValue(0.5, keys, 0, 'linear')).toBeCloseTo(50, 4)
    expect(evalValue(0.25, keys, 0, 'cubicOut')).toBeCloseTo(applyEase('cubicOut', 0.25) * 100, 4)
  })

  it("lets a keyframe's own curve win over the default", () => {
    const keys = [key(0, 0, 'expoOut'), key(1, 100)]
    expect(evalValue(0.3, keys, 0, 'linear')).toBeCloseTo(applyEase('expoOut', 0.3) * 100, 4)
    // and the curve belongs to the segment LEAVING that key, so the second
    // key's own ease is irrelevant here
    const other = [key(0, 0, 'expoOut'), key(1, 100, 'linear')]
    expect(evalValue(0.3, other, 0, 'linear')).toBeCloseTo(evalValue(0.3, keys, 0, 'linear'), 6)
  })

  it('survives two keyframes stacked at the same time', () => {
    const keys = [key(0.5, 10), key(0.5, 90)]
    expect(Number.isFinite(evalValue(0.5, keys, 0, 'linear'))).toBe(true)
  })
})

describe('evalProgress', () => {
  it('spans the whole path through the default curve with no keyframes', () => {
    expect(evalProgress(0, [], 'linear')).toBe(0)
    expect(evalProgress(1, [], 'linear')).toBe(1)
    expect(evalProgress(0.5, [], 'linear')).toBeCloseTo(0.5, 4)
    expect(evalProgress(0.25, [], 'quartInOut')).toBeCloseTo(applyEase('quartInOut', 0.25), 4)
  })

  it('honours a keyframe and its curve', () => {
    const keys: ProgressKey[] = [{ id: 'a', time: 0.5, progress: 0.9, ease: 'linear' }]
    expect(evalProgress(0.5, keys, 'expoInOut')).toBeCloseTo(0.9, 6)
    // 0.5 -> 1.0 in time maps 0.9 -> 1.0 in progress, linear per the key's ease
    expect(evalProgress(0.75, keys, 'expoInOut')).toBeCloseTo(0.95, 4)
  })

  it('never runs backwards past the last keyframe', () => {
    const keys: ProgressKey[] = [{ id: 'a', time: 1, progress: 0.4 }]
    expect(evalProgress(1, keys, 'linear')).toBeCloseTo(0.4, 6)
  })
})

describe('evalVec3', () => {
  it('falls back to the static target', () => {
    const fallback: Vec3 = [1, 2, 3]
    expect(evalVec3(0.5, [], fallback, 'linear')).toBe(fallback)
  })

  it('interpolates each component', () => {
    const keys = [
      { id: 'a', time: 0, value: [0, 0, 0] as Vec3 },
      { id: 'b', time: 1, value: [10, 20, 30] as Vec3 },
    ]
    expect(evalVec3(0.5, keys, [0, 0, 0], 'linear')).toEqual([5, 10, 15])
  })
})
