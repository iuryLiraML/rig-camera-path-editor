import { describe, expect, it } from 'vitest'
import {
  evalModelTransform,
  evalProgress,
  evalValue,
  evalVec3,
  spliceObjectKeysAtTime,
  type ModelKey,
  type ProgressKey,
  type ValueKey,
} from './keyframes'
import { applyEase } from './easing'
import { identityTransform, type Vec3 } from '../state/useSceneStore'

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

  it('retimes an interval via easeOut without changing the keyed values', () => {
    const keys = [key(0, 0), key(1, 100)]
    keys[0].easeOut = 0
    expect(evalValue(0, keys, 0, 'linear')).toBe(0)
    expect(evalValue(1, keys, 0, 'linear')).toBe(100)
    expect(evalValue(0.5, keys, 0, 'linear')).toBeLessThan(50)
  })

  it("lets a keyframe's own curve win over the default", () => {
    const keys = [key(0, 0, 'expoOut'), key(1, 100)]
    expect(evalValue(0.3, keys, 0, 'linear')).toBeCloseTo(applyEase('expoOut', 0.3) * 100, 4)
    // and the curve belongs to the segment LEAVING that key, so the second
    // key's own ease is irrelevant here
    const other = [key(0, 0, 'expoOut'), key(1, 100, 'linear')]
    expect(evalValue(0.3, other, 0, 'linear')).toBeCloseTo(evalValue(0.3, keys, 0, 'linear'), 6)
  })

  it("lets a keyframe's own cubic-bezier win over the named curve", () => {
    const keys: ValueKey[] = [
      { id: 'a', time: 0, value: 0, ease: 'linear', easeBezier: [0.33, 1, 0.68, 1] },
      { id: 'b', time: 1, value: 100 },
    ]
    expect(evalValue(0.5, keys, 0, 'linear')).toBeGreaterThan(70)
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

const pose = (
  id: string,
  time: number,
  patch: Partial<typeof identityTransform> = {},
  channel?: ModelKey['channel'],
): ModelKey => ({
  id,
  time,
  channel,
  transform: { ...identityTransform, ...patch },
})

describe('evalModelTransform', () => {
  it('still interpolates legacy full-pose keys', () => {
    const keys = [
      pose('k0', 0, { position: [0, 0, 0] }),
      pose('k1', 1, { position: [4, 0, 0] }),
    ]
    const result = evalModelTransform(0.5, keys, 'linear', identityTransform)!
    expect(result.position[0]).toBeCloseTo(2, 5)
  })

  it('interpolates position independently of rotation and scale', () => {
    const keys: ModelKey[] = [
      pose('p0', 0, { position: [0, 0, 0] }, 'position'),
      pose('p1', 1, { position: [10, 0, 0] }, 'position'),
      pose('r0', 0, { rotation: [0, 0, 0] }, 'rotation'),
      pose('r1', 1, { rotation: [0, 90, 0] }, 'rotation'),
    ]
    const mid = evalModelTransform(0.5, keys, 'linear', identityTransform)!
    expect(mid.position[0]).toBeCloseTo(5, 5)
    expect(mid.rotation[1]).toBeCloseTo(45, 4)
    expect(mid.scale).toEqual([1, 1, 1])
  })

  it('holds static rotation when only position is keyed', () => {
    const fallback = { ...identityTransform, rotation: [0, 30, 0] as Vec3 }
    const keys: ModelKey[] = [
      pose('p0', 0, { position: [0, 0, 0] }, 'position'),
      pose('p1', 1, { position: [8, 0, 0] }, 'position'),
    ]
    const mid = evalModelTransform(0.5, keys, 'linear', fallback)!
    expect(mid.position[0]).toBeCloseTo(4, 5)
    expect(mid.rotation[1]).toBeCloseTo(30, 5)
  })
})

describe('spliceObjectKeysAtTime', () => {
  it('splits a legacy pose key so Delete on position keeps rotation and scale', () => {
    const keys: ModelKey[] = [pose('legacy', 0.4, { position: [1, 0, 0] })]
    let n = 0
    const next = spliceObjectKeysAtTime(keys, 0.4, ['position'], () => `n${n++}`)
    expect(next.map((k) => k.channel).sort()).toEqual(['rotation', 'scale'])
    expect(next.every((k) => k.time === 0.4)).toBe(true)
  })
})
