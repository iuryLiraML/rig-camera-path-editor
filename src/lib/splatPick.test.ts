import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { attachEnvironmentPickProxy, splatPickBounds } from './splatPick'

describe('splatPickBounds', () => {
  it('uses the splat tree scene extents when they exist', () => {
    const mesh = new THREE.Object3D() as THREE.Object3D & {
      getSplatTree: () => {
        subTrees: { sceneMin: THREE.Vector3; sceneMax: THREE.Vector3 }[]
      }
    }
    mesh.getSplatTree = () => ({
      subTrees: [
        {
          sceneMin: new THREE.Vector3(-2, 0, -1),
          sceneMax: new THREE.Vector3(4, 3, 2),
        },
      ],
    })
    const box = splatPickBounds(mesh)
    expect(box?.min.toArray()).toEqual([-2, 0, -1])
    expect(box?.max.toArray()).toEqual([4, 3, 2])
  })
})

describe('attachEnvironmentPickProxy', () => {
  it('tags a pick mesh so the palco can be selected', () => {
    const mesh = new THREE.Object3D() as THREE.Object3D & { getSplatTree?: () => null }
    const proxy = attachEnvironmentPickProxy(mesh)
    expect(proxy.name).toBe('environment-pick')
    expect(proxy.userData.pickKind).toBe('env')
    expect(proxy.userData.pickId).toBe('env')
    expect(mesh.children).toContain(proxy)
  })
})
