import { describe, expect, it } from 'vitest'
import type { Vec3Key } from './keyframes'
import {
  composeVec3Keys,
  evalCinemaVec3,
  evalSeparatedVec3,
  explodeVec3Keys,
  hydrateVec3Group,
} from './vec3Axes'

const vec = (time: number, value: [number, number, number]): Vec3Key => ({
  id: `v${time}`,
  time,
  value,
})

describe('explodeVec3Keys', () => {
  it('turns one vec3 key into three scalar keys at the same time', () => {
    const [x, y, z] = explodeVec3Keys([vec(0.25, [1, 2, 3])])
    expect(x).toHaveLength(1)
    expect(y[0].value).toBe(2)
    expect(z[0].time).toBeCloseTo(0.25)
    expect(x[0].id).not.toBe(y[0].id)
  })
})

describe('evalSeparatedVec3', () => {
  it('animates X without moving Y when Y has no keys', () => {
    const x = [
      { id: 'a', time: 0, value: 0 },
      { id: 'b', time: 1, value: 10 },
    ]
    expect(evalSeparatedVec3(0.5, x, [], [], [0, 4, 5], 'linear')).toEqual([5, 4, 5])
  })
})

describe('evalCinemaVec3', () => {
  it('prefers axis tracks over a coupled vec3 list', () => {
    const legacy: Vec3Key[] = [vec(0, [9, 9, 9]), vec(1, [0, 0, 0])]
    const x = [
      { id: 'a', time: 0, value: 0 },
      { id: 'b', time: 1, value: 10 },
    ]
    expect(evalCinemaVec3(0.5, { x }, legacy, [0, 1, 2], 'linear')[0]).toBeCloseTo(5)
    expect(evalCinemaVec3(0.5, { x }, legacy, [0, 1, 2], 'linear')[1]).toBe(1)
  })

  it('falls back to coupled vec3 when no axis tracks exist', () => {
    const legacy: Vec3Key[] = [vec(0, [0, 0, 0]), vec(1, [10, 20, 30])]
    expect(evalCinemaVec3(0.5, {}, legacy, [0, 0, 0], 'linear')).toEqual([5, 10, 15])
  })
})

describe('hydrateVec3Group', () => {
  it('explodes legacy staticPosKeys', () => {
    const next = hydrateVec3Group(
      { staticPosKeys: [vec(0, [1, 2, 3])] },
      'staticPos',
    )
    expect(next.x[0].value).toBe(1)
    expect(next.y[0].value).toBe(2)
    expect(next.z[0].value).toBe(3)
  })

  it('prefers already-split scalar keys', () => {
    const next = hydrateVec3Group(
      {
        staticPosKeys: [vec(0, [9, 9, 9])],
        staticPosXKeys: [{ id: 'x', time: 0, value: 4 }],
      },
      'staticPos',
    )
    expect(next.x[0].value).toBe(4)
    expect(next.y).toHaveLength(0)
  })
})

describe('composeVec3Keys', () => {
  it('samples unkeyed axes at the other axes’ times so Y does not start animating', () => {
    const x = [
      { id: 'a', time: 0, value: 0 },
      { id: 'b', time: 1, value: 10 },
    ]
    const composed = composeVec3Keys(x, [], [], [0, 7, 8], 'linear', 'pos')
    expect(composed).toHaveLength(2)
    expect(composed[0].value[1]).toBe(7)
    expect(composed[1].value[1]).toBe(7)
  })
})
