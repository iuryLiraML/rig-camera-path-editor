import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { boundsAreUsable, meshWorldBounds, prepareImportedRoot, repairImportedShading } from './prepareImport'
import { normalizeModel } from '../state/useSceneStore'

describe('prepareImportedRoot', () => {
  it('computes vertex normals so clay can shade a SAM mesh', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    )
    const mesh = new THREE.Mesh(geometry)
    const root = new THREE.Group()
    root.add(mesh)

    prepareImportedRoot(root)

    const normals = mesh.geometry.attributes.normal
    expect(normals).toBeTruthy()
    expect(normals.count).toBe(3)
    const nz = Math.abs(normals.getZ(0))
    expect(nz).toBeGreaterThan(0.5)
  })

  it('strips cameras and keypoint clouds so bounds match the body', () => {
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)))
    root.add(new THREE.PerspectiveCamera())
    const cloud = new THREE.BufferGeometry()
    cloud.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([80, 80, 80]), 3),
    )
    root.add(new THREE.Points(cloud))

    prepareImportedRoot(root)

    expect(root.children).toHaveLength(1)
    expect(root.children[0]).toBeInstanceOf(THREE.Mesh)
    const size = meshWorldBounds(root).getSize(new THREE.Vector3())
    expect(size.y).toBeGreaterThan(1)
    expect(size.y).toBeLessThan(3)
  })

  it('keeps the VGGT cloud and drops estimated-camera cones', () => {
    const root = new THREE.Group()
    const cloud = new THREE.BufferGeometry()
    cloud.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 4, 0, 0, 0, 2, 0]), 3))
    root.add(new THREE.Points(cloud))
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 8))
    cone.name = 'CameraCone'
    root.add(cone)
    root.add(new THREE.PerspectiveCamera())

    prepareImportedRoot(root, { keepPoints: true })

    expect(root.children).toHaveLength(1)
    expect(root.children[0]).toBeInstanceOf(THREE.Points)
    const size = meshWorldBounds(root, { keepPoints: true }).getSize(new THREE.Vector3())
    expect(size.x).toBeGreaterThan(3)
  })

  it('recomputes zeroed normals', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const zeros = new Float32Array(geometry.attributes.normal.count * 3)
    geometry.setAttribute('normal', new THREE.BufferAttribute(zeros, 3))
    const mesh = new THREE.Mesh(geometry)
    const root = new THREE.Group()
    root.add(mesh)
    repairImportedShading(root)
    const n = mesh.geometry.attributes.normal
    expect(Math.hypot(n.getX(0), n.getY(0), n.getZ(0))).toBeGreaterThan(0.5)
  })
})

describe('normalizeModel', () => {
  it('does not collapse an empty root to scale 0', () => {
    const root = new THREE.Group()
    normalizeModel(root)
    expect(root.scale.toArray()).toEqual([1, 1, 1])
    expect(Number.isFinite(root.position.y)).toBe(true)
  })

  it('scales a body mesh to about two units', () => {
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(10, 20, 10)))
    prepareImportedRoot(root)
    normalizeModel(root)
    const size = meshWorldBounds(root).getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    expect(maxDim).toBeCloseTo(2, 1)
    expect(boundsAreUsable(meshWorldBounds(root))).toBe(true)
  })

  it('scales a kept point cloud to about two units', () => {
    const root = new THREE.Group()
    const cloud = new THREE.BufferGeometry()
    cloud.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 10, 0, 0, 0, 20, 0]), 3))
    root.add(new THREE.Points(cloud))
    prepareImportedRoot(root, { keepPoints: true })
    normalizeModel(root, { includePoints: true })
    const size = meshWorldBounds(root, { keepPoints: true }).getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    expect(maxDim).toBeCloseTo(2, 1)
  })
})
