import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { makeAnchor, type MotionPath } from '../state/usePathStore'
import {
  collectLassoHits,
  objectRepresentativePoints,
  pointInPolygon,
  projectToPane,
  samplePathToPane,
} from './lasso'

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

describe('lasso geometry', () => {
  it('includes convex interiors and edges', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
    expect(pointInPolygon({ x: 0, y: 5 }, square)).toBe(true)
    expect(pointInPolygon({ x: 12, y: 5 }, square)).toBe(false)
  })

  it('handles concave polygons', () => {
    const concave = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 8 },
      { x: 4, y: 4 },
      { x: 0, y: 8 },
    ]
    expect(pointInPolygon({ x: 2, y: 5 }, concave)).toBe(true)
    expect(pointInPolygon({ x: 4, y: 6 }, concave)).toBe(false)
  })

  it('projects into pane-local coordinates and rejects points behind the camera', () => {
    const camera = new THREE.PerspectiveCamera(90, 2, 0.1, 100)
    camera.position.set(0, 0, 0)
    camera.lookAt(0, 0, -1)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()

    expect(projectToPane(new THREE.Vector3(0, 0, -2), camera, { w: 200, h: 100 })).toEqual({
      x: 100,
      y: 50,
    })
    expect(projectToPane(new THREE.Vector3(0, 0, 2), camera, { w: 200, h: 100 })).toBeNull()
  })

  it('uses world bounds center and corners as object representatives', () => {
    const group = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6))
    group.add(mesh)
    group.position.set(10, 3, -2)
    group.updateMatrixWorld(true)

    const points = objectRepresentativePoints(group)
    expect(points).toHaveLength(9)
    expect(points.some((point) => point.equals(new THREE.Vector3(10, 3, -2)))).toBe(true)
    expect(points.some((point) => point.equals(new THREE.Vector3(9, 1, -5)))).toBe(true)
  })

  it('hits a sampled whole curve and preserves candidate order', () => {
    const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
    const path: MotionPath = {
      id: 'route',
      name: 'Route',
      anchors: [makeAnchor([-4, 0, 0]), makeAnchor([4, 0, 0])],
      closed: false,
      rounding: 0,
    }
    const samples = samplePathToPane(path, camera, { w: 100, h: 100 }, null, 24)
    const polygon = [
      { x: 45, y: 45 },
      { x: 55, y: 45 },
      { x: 55, y: 55 },
      { x: 45, y: 55 },
    ]

    expect(
      collectLassoHits(polygon, [
        { id: 'obj:first', points: [{ x: 50, y: 50 }] },
        { id: 'path:route', points: samples },
      ]),
    ).toEqual(['obj:first', 'path:route'])
  })
})
