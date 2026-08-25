import { describe, expect, it } from 'vitest'
import {
  isOrbitLocked,
  lockOrbit,
  resetOrbitLock,
  restoreViewportNav,
  unlockOrbit,
} from './orbitLock'

describe('restoreViewportNav', () => {
  it('clears a leaked lock so orbit can enable again', () => {
    resetOrbitLock()
    lockOrbit()
    lockOrbit()
    expect(isOrbitLocked()).toBe(true)
    restoreViewportNav()
    expect(isOrbitLocked()).toBe(false)
  })

  it('re-enables controls and drops a half-finished gesture', () => {
    const controls = { enabled: false, state: 1, _pointers: [1, 2] }
    restoreViewportNav(controls)
    expect(controls.enabled).toBe(true)
    expect(controls.state).toBe(-1)
    expect(controls._pointers).toHaveLength(0)
    unlockOrbit()
    expect(isOrbitLocked()).toBe(false)
  })
})
