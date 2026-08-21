import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { aimOrbitAtWorldOrigin, DEFAULT_HOME_DIST } from './orbitHome'

describe('aimOrbitAtWorldOrigin', () => {
  it('moves the orbit target to the origin and keeps the view direction at home distance', () => {
    const position = new THREE.Vector3(6, 4, 8)
    const target = new THREE.Vector3(2, 1, 3)
    const dir = position.clone().sub(target).normalize()

    aimOrbitAtWorldOrigin(position, target)

    expect(target.toArray()).toEqual([0, 0, 0])
    expect(position.distanceTo(target)).toBeCloseTo(DEFAULT_HOME_DIST, 8)
    const nextDir = position.clone().sub(target).normalize()
    expect(nextDir.dot(dir)).toBeCloseTo(1, 8)
  })

  it('uses a fallback offset when the camera is already on the target', () => {
    const position = new THREE.Vector3(1, 1, 1)
    const target = new THREE.Vector3(1, 1, 1)

    aimOrbitAtWorldOrigin(position, target)

    expect(target.toArray()).toEqual([0, 0, 0])
    expect(position.distanceTo(target)).toBeCloseTo(DEFAULT_HOME_DIST, 8)
  })
})
