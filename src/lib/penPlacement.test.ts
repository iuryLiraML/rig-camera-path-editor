import { describe, expect, it } from 'vitest'
import { constructionHeight, snapActive, snapToGridXZ } from './penPlacement'
import type { Vec3 } from '../state/useSceneStore'

describe('snapToGridXZ', () => {
  it('rounds X and Z to the nearest cell but leaves Y untouched', () => {
    const p: Vec3 = [1.12, 3.7, -0.9]
    expect(snapToGridXZ(p, 0.5)).toEqual([1, 3.7, -1])
  })

  it('is a no-op for a non-positive cell size', () => {
    const p: Vec3 = [1.12, 3.7, -0.9]
    expect(snapToGridXZ(p, 0)).toBe(p)
  })
})

describe('snapActive', () => {
  it('Ctrl inverts the persistent toggle', () => {
    expect(snapActive(true, false)).toBe(true)
    expect(snapActive(true, true)).toBe(false)
    expect(snapActive(false, false)).toBe(false)
    expect(snapActive(false, true)).toBe(true)
  })
})

describe('constructionHeight', () => {
  it('uses the ground for the first point', () => {
    expect(constructionHeight(null, 0)).toBe(0)
  })

  it('continues from the previous anchor height plus the live offset', () => {
    expect(constructionHeight(2.4, 0.5)).toBeCloseTo(2.9)
    expect(constructionHeight(2.4, -1)).toBeCloseTo(1.4)
  })
})
