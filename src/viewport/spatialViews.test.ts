import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { lockOrbit, resetOrbitLock } from '../lib/orbitLock'

vi.mock('./SceneObjects', () => ({ sceneBounds: () => null }))

import {
  bindOrbitToPane,
  ensureSpatialCamera,
  resetSpatialViews,
  spatialCameras,
  type OrbitLike,
} from './spatialViews'

function fakeOrbit(object: THREE.Object3D): OrbitLike {
  return {
    object,
    target: new THREE.Vector3(0, 0.8, 0),
    enabled: true,
    minPolarAngle: 0.02,
    maxPolarAngle: Math.PI - 0.02,
    update: () => {},
  }
}

describe('spatialViews', () => {
  beforeEach(() => {
    resetSpatialViews()
    resetOrbitLock()
  })

  it('frames a spatial camera once, then keeps a user orbit', () => {
    ensureSpatialCamera('front', 1)
    const first = spatialCameras.front.position.clone()
    spatialCameras.front.position.set(9, 8, 7)
    ensureSpatialCamera('front', 1)
    expect(spatialCameras.front.position.toArray()).toEqual([9, 8, 7])
    expect(first.length()).toBeGreaterThan(1)
  })

  it('binds orbit to a spatial camera without resetting it on a second hover', () => {
    const editor = new THREE.PerspectiveCamera()
    editor.position.set(5, 3, 5)
    const controls = fakeOrbit(editor)
    bindOrbitToPane(controls, 'front', editor, true)
    expect(controls.object).toBe(spatialCameras.front)
    expect(controls.enabled).toBe(true)
    spatialCameras.front.position.set(4, 5, 6)
    bindOrbitToPane(controls, 'front', editor, true)
    expect(spatialCameras.front.position.toArray()).toEqual([4, 5, 6])
  })

  it('does not orbit the cinema pane', () => {
    const editor = new THREE.PerspectiveCamera()
    const controls = fakeOrbit(editor)
    bindOrbitToPane(controls, 'camera', editor, true)
    expect(controls.enabled).toBe(false)
    expect(controls.object).toBe(editor)
  })

  it('does not re-enable orbit while a pick gesture holds the lock', () => {
    const editor = new THREE.PerspectiveCamera()
    const controls = fakeOrbit(editor)
    lockOrbit()
    bindOrbitToPane(controls, 'editor', editor, true)
    expect(controls.enabled).toBe(false)
    bindOrbitToPane(controls, 'editor', editor, true)
    expect(controls.enabled).toBe(false)
  })
})
