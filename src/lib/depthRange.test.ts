import { describe, expect, it } from 'vitest'
import { applyDepthUniforms, fitDepthRange, resolveDepthRange } from './depthRange'

describe('depthRange', () => {
  it('fits a window around the scene from the camera distance', () => {
    const range = fitDepthRange(10, 2)
    expect(range.near).toBeCloseTo(Math.max(0.05, 10 - 2 * 1.6))
    expect(range.far).toBeCloseTo(10 + 2 * 1.6)
  })

  it('writes the slider range when auto is off', () => {
    const uniforms = { uNear: { value: 0.1 }, uFar: { value: 20 } }
    const range = resolveDepthRange(false, { near: 1.5, far: 8 }, { near: 0.2, far: 30 })
    applyDepthUniforms(uniforms, range)
    expect(uniforms.uNear.value).toBe(1.5)
    expect(uniforms.uFar.value).toBe(8)
  })

  it('keeps the fitted bounds when auto is on', () => {
    const fitted = { near: 0.4, far: 12 }
    expect(resolveDepthRange(true, { near: 2, far: 5 }, fitted)).toEqual(fitted)
  })
})
