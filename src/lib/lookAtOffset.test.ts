import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { localAabbCenter } from './lookAtOffset'

describe('localAabbCenter', () => {
  it('returns the mesh center in object-local space', () => {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1))
    mesh.position.set(0, 1, 0)
    root.add(mesh)
    const center = localAabbCenter(root, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    })
    expect(center[0]).toBeCloseTo(0, 3)
    expect(center[1]).toBeCloseTo(1, 3)
    expect(center[2]).toBeCloseTo(0, 3)
  })

  it('returns origin when there is no mesh', () => {
    const root = new THREE.Group()
    expect(localAabbCenter(root, {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    })).toEqual([0, 0, 0])
  })
})
