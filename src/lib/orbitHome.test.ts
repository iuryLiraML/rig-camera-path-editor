import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { aimOrbitAtWorldOrigin } from './orbitHome'

describe('aimOrbitAtWorldOrigin', () => {
  it('moves the orbit target to the world origin and keeps the look offset', () => {
    const position = new THREE.Vector3(6, 4, 8)
    const target = new THREE.Vector3(2, 1, 3)
    const offset = position.clone().sub(target)

    aimOrbitAtWorldOrigin(position, target)

    expect(target.toArray()).toEqual([0, 0, 0])
    expect(position.x).toBeCloseTo(offset.x, 8)
    expect(position.y).toBeCloseTo(offset.y, 8)
    expect(position.z).toBeCloseTo(offset.z, 8)
    expect(position.distanceTo(target)).toBeCloseTo(offset.length(), 8)
  })

  it('uses a fallback offset when the camera is already on the target', () => {
    const position = new THREE.Vector3(1, 1, 1)
    const target = new THREE.Vector3(1, 1, 1)

    aimOrbitAtWorldOrigin(position, target)

    expect(target.toArray()).toEqual([0, 0, 0])
    expect(position.distanceTo(target)).toBeGreaterThan(1)
  })
})
