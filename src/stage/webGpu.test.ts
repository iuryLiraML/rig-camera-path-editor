// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { isWebGpuAvailable } from './webGpu'

describe('isWebGpuAvailable', () => {
  it('is false when navigator.gpu is missing', () => {
    vi.stubGlobal('navigator', {})
    expect(isWebGpuAvailable()).toBe(false)
  })

  it('is true when navigator.gpu exists', () => {
    vi.stubGlobal('navigator', { gpu: {} })
    expect(isWebGpuAvailable()).toBe(true)
  })
})
