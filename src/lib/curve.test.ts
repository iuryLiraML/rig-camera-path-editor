import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildCurve, nearestSegmentHit } from './curve'
import type { PathAnchor } from '../state/usePathStore'

function corner(id: string, x: number, z: number): PathAnchor {
  return {
    id,
    position: [x, 0, z],
    handleIn: [0, 0, 0],
    handleOut: [0, 0, 0],
    mirrored: true,
    manual: true,
  }
}

describe('nearestSegmentHit', () => {
  const curve = buildCurve([corner('a', 0, 0), corner('b', 10, 0), corner('c', 10, 10)], false, 0)

  it('returns the segment index when the point lies on the curve', () => {
    expect(curve).not.toBeNull()
    expect(nearestSegmentHit(curve!, new THREE.Vector3(5, 0, 0))).toBe(0)
    expect(nearestSegmentHit(curve!, new THREE.Vector3(10, 0, 5))).toBe(1)
  })

  it('returns null when the point is off the curve', () => {
    expect(curve).not.toBeNull()
    expect(nearestSegmentHit(curve!, new THREE.Vector3(5, 0, 8))).toBeNull()
    expect(nearestSegmentHit(curve!, new THREE.Vector3(0, 0, 10))).toBeNull()
  })
})
