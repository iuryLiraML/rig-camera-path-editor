import { describe, expect, it } from 'vitest'
import { buildRacingDroneCameraSpecs } from './generateRacingDroneCameras'

describe('racing drone camera recipes', () => {
  it('builds ten reframed recipes with safe standoff and target look-at', () => {
    const specs = buildRacingDroneCameraSpecs(10)
    expect(specs).toHaveLength(10)
    for (const spec of specs) {
      expect(spec.anchors.length).toBeGreaterThanOrEqual(3)
      expect(spec.fov).toBeGreaterThanOrEqual(55)
      expect(spec.fov).toBeLessThanOrEqual(75)
      expect(spec.name.startsWith('RD ')).toBe(true)
      expect(spec.lookAt).toBe('target')
      expect(spec.target.length).toBe(3)
      for (const anchor of spec.anchors) {
        const dist = Math.hypot(anchor[0], anchor[2])
        expect(dist).toBeGreaterThan(0.9)
        expect(anchor[1]).toBeGreaterThan(0)
      }
    }
    const names = new Set(specs.map((spec) => spec.name))
    expect(names.size).toBe(10)
  })
})
