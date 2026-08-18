import { describe, expect, it } from 'vitest'
import { DEMO_LOCATION, DEMO_LOCATION_SIDECAR } from './demoConfig'
import { locationTransform, parseLocationSidecar } from './locationSidecar'

/**
 * The demo Location's rotation used to be the literal `[-90, 0, 0]` in
 * `demoConfig.ts`. E1.4 replaced it with `upAxis: 'z'` and derives the rotation,
 * which is only an improvement if the derived value is identical — otherwise the
 * spike's one working Location silently moves.
 */
describe('demo Location sidecar', () => {
  it('is a valid sidecar', () => {
    const result = parseLocationSidecar(DEMO_LOCATION_SIDECAR)
    expect(result.ok, result.ok ? '' : result.message).toBe(true)
  })

  it('derives exactly the rotation the config used to hard-code', () => {
    expect(locationTransform(DEMO_LOCATION.sidecar).eulerDegrees).toEqual([-90, 0, 0])
  })

  it('does not move or rescale the demo', () => {
    const placement = locationTransform(DEMO_LOCATION.sidecar)
    expect(placement.position).toEqual([0, 0, 0])
    expect(placement.scale).toBe(1)
  })

  it('keeps the hand-picked framing out of the sidecar', () => {
    // camera/focus for this dataset were chosen by eye; they are not measurements
    // and must not masquerade as ingest output
    expect('cameraPosition' in DEMO_LOCATION_SIDECAR).toBe(false)
    expect(DEMO_LOCATION.cameraPosition).toHaveLength(3)
    expect(DEMO_LOCATION.focusPoint).toHaveLength(3)
  })
})
