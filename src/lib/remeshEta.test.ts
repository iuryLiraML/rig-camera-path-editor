import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_REMESH_MS,
  REMESH_BAR_CAP,
  expectedRemeshMs,
  formatRemeshClock,
  liveExpectedRemeshMs,
  recordRemeshDuration,
  remeshBarFraction,
  remeshBarState,
  remeshEtaCopy,
  remeshTimeProgress,
  resetRemeshEtaForTests,
} from './remeshEta'

afterEach(() => {
  resetRemeshEtaForTests()
})

describe('expectedRemeshMs', () => {
  it('uses the shipped typical when there is no history', () => {
    expect(expectedRemeshMs([])).toBe(DEFAULT_REMESH_MS)
  })

  it('averages recorded waits and clamps the result', () => {
    expect(expectedRemeshMs([60_000, 80_000, 100_000])).toBe(80_000)
    expect(expectedRemeshMs([5_000])).toBe(30_000)
    expect(expectedRemeshMs([400_000])).toBe(180_000)
  })
})

describe('remesh time bar', () => {
  it('fills from elapsed / typical and never reaches 100% on the clock', () => {
    expect(remeshTimeProgress(0, DEFAULT_REMESH_MS)).toBe(0)
    expect(remeshTimeProgress(45_000, DEFAULT_REMESH_MS)).toBeCloseTo(0.5, 5)
    expect(remeshTimeProgress(200_000, DEFAULT_REMESH_MS)).toBe(REMESH_BAR_CAP)
  })

  it('lets a real Fal fraction pull the bar ahead of the clock', () => {
    expect(remeshBarFraction(9_000, DEFAULT_REMESH_MS, 0.7)).toBe(0.7)
    expect(remeshBarFraction(45_000, DEFAULT_REMESH_MS, 0.2)).toBeCloseTo(0.5, 5)
  })

  it('prints remaining time against the typical wait', () => {
    expect(formatRemeshClock(80_000)).toBe('1:20')
    expect(remeshEtaCopy(80_000, 90_000, false)).toBe('1:20 left · typically 1:30')
    expect(remeshEtaCopy(3_000, 90_000, false)).toBe('Finishing… · typically 1:30')
    expect(remeshEtaCopy(0, 90_000, true)).toBe('Taking longer than usual · typically 1:30')
  })

  it('builds the overlay state from a start time', () => {
    const state = remeshBarState({
      startedAt: 1_000,
      now: 31_000,
      expectedMs: 90_000,
      falProgress: null,
    })
    expect(state.elapsedMs).toBe(30_000)
    expect(state.remainingMs).toBe(60_000)
    expect(state.fraction).toBeCloseTo(1 / 3, 5)
    expect(state.label).toBe('1:00 left · typically 1:30')
  })
})

describe('remesh duration memory', () => {
  it('feeds the next typical wait from completed remeshes', () => {
    resetRemeshEtaForTests()
    recordRemeshDuration(60_000)
    recordRemeshDuration(80_000)
    expect(liveExpectedRemeshMs()).toBe(70_000)
  })

  it('ignores cancelled or instant jobs', () => {
    recordRemeshDuration(800)
    expect(liveExpectedRemeshMs()).toBe(DEFAULT_REMESH_MS)
  })
})
