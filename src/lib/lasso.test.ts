import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { makeAnchor, type MotionPath } from '../state/usePathStore'
import {
  collectAnchorLassoHits,
  collectLassoHits,
  collectLassoResult,
  objectRepresentativePoints,
  pointInPolygon,
  projectPathAnchorsToPane,
  projectToPane,
  samplePathToPane,
} from './lasso'

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

function makePerformanceScenario() {
  const center = { x: 500, y: 400 }
  const polygon = Array.from({ length: 64 }, (_, index) => {
    const angle = (index / 64) * Math.PI * 2
    const radius = index % 2 === 0 ? 245 : 240
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }
  })
  const pointOnRing = (index: number, count: number, radius: number) => {
    const angle = (index / count) * Math.PI * 2
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }
  }
  const anchorCandidates = Array.from({ length: 1_000 }, (_, index) => ({
    ref: { pathId: `perf-path-${Math.floor(index / 20)}`, anchorId: `anchor-${index}` },
    point: pointOnRing(index, 1_000, index < 600 ? 180 : 340),
  }))
  const objectCandidates = Array.from({ length: 500 }, (_, index) => {
    const candidateCenter = pointOnRing(index, 500, index < 300 ? 170 : 350)
    return {
      id: `obj:perf-${index}` as const,
      points: [-4, 0, 4].flatMap((x) =>
        [-4, 0, 4].map((y) => ({
          x: candidateCenter.x + x,
          y: candidateCenter.y + y,
        })),
      ),
    }
  })
  return { polygon, anchorCandidates, objectCandidates }
}

describe('lasso geometry', () => {
  it('includes convex interiors and edges', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
    expect(pointInPolygon({ x: 0, y: 5 }, square)).toBe(true)
    expect(pointInPolygon({ x: 12, y: 5 }, square)).toBe(false)
  })

  it('does not treat a duplicated closing point as an edge containing everything', () => {
    const explicitlyClosed = [...square, square[0]]
    expect(pointInPolygon({ x: 5, y: 5 }, explicitlyClosed)).toBe(true)
    expect(pointInPolygon({ x: 12, y: 5 }, explicitlyClosed)).toBe(false)
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

  it('projects path-qualified anchor centers and rejects anchors behind the view', () => {
    const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100)
    camera.lookAt(0, 0, -1)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
    const front = makeAnchor([0, 0, -2])
    const behind = makeAnchor([0, 0, 2])
    const path: MotionPath = {
      id: 'route',
      name: 'Route',
      anchors: [front, behind],
      closed: false,
      rounding: 0,
    }

    expect(projectPathAnchorsToPane(path, camera, { w: 100, h: 100 }, null)).toEqual([
      { ref: { pathId: 'route', anchorId: front.id }, point: { x: 50, y: 50 } },
    ])
  })

  it('applies parent transforms to projected anchor centers', () => {
    const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
    const anchor = makeAnchor([0, 0, 0])
    const path: MotionPath = {
      id: 'route',
      name: 'Route',
      anchors: [anchor],
      closed: false,
      rounding: 0,
    }

    expect(
      projectPathAnchorsToPane(path, camera, { w: 100, h: 100 }, {
        position: [2, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }),
    ).toEqual([{ ref: { pathId: 'route', anchorId: anchor.id }, point: { x: 70, y: 50 } }])
  })

  it('includes boundary anchors and preserves stable path-anchor candidate order', () => {
    const candidates = [
      { ref: { pathId: 'path-b', anchorId: 'b-2' }, point: { x: 10, y: 5 } },
      { ref: { pathId: 'path-a', anchorId: 'a-1' }, point: { x: 5, y: 5 } },
      { ref: { pathId: 'path-b', anchorId: 'b-1' }, point: { x: 12, y: 5 } },
    ]

    expect(collectAnchorLassoHits(square, candidates)).toEqual([
      { pathId: 'path-b', anchorId: 'b-2' },
      { pathId: 'path-a', anchorId: 'a-1' },
    ])
  })

  it('keeps whole-curve and anchor hits in one result with anchors after top-level hits', () => {
    const result = collectLassoResult(
      square,
      [
        { id: 'obj:first', points: [{ x: 2, y: 2 }] },
        { id: 'path:route', points: [{ x: 8, y: 8 }] },
      ],
      [
        { ref: { pathId: 'route', anchorId: 'outside' }, point: { x: 12, y: 5 } },
        { ref: { pathId: 'route', anchorId: 'inside-b' }, point: { x: 7, y: 5 } },
        { ref: { pathId: 'route', anchorId: 'inside-a' }, point: { x: 3, y: 5 } },
      ],
    )

    expect(result).toEqual([
      { kind: 'top-level', id: 'obj:first' },
      { kind: 'top-level', id: 'path:route' },
      { kind: 'anchor', ref: { pathId: 'route', anchorId: 'inside-b' } },
      { kind: 'anchor', ref: { pathId: 'route', anchorId: 'inside-a' } },
    ])
  })

  it('selects only anchor centers enclosed by the lasso, independent of curve-line hits', () => {
    expect(
      collectLassoResult(
        square,
        [{ id: 'path:route', points: [{ x: 5, y: 5 }] }],
        [
          { ref: { pathId: 'route', anchorId: 'left' }, point: { x: -1, y: 5 } },
          { ref: { pathId: 'route', anchorId: 'edge' }, point: { x: 10, y: 5 } },
          { ref: { pathId: 'route', anchorId: 'right' }, point: { x: 11, y: 5 } },
        ],
      ),
    ).toEqual([
      { kind: 'top-level', id: 'path:route' },
      { kind: 'anchor', ref: { pathId: 'route', anchorId: 'edge' } },
    ])
  })

  it('collects 1,000 visible anchors and 500 objects within the 100 ms release target', () => {
    const { polygon, anchorCandidates, objectCandidates } = makePerformanceScenario()

    for (let warmup = 0; warmup < 2; warmup++) {
      collectLassoResult(polygon, objectCandidates, anchorCandidates)
    }

    const samples = Array.from({ length: 5 }, () => {
      const startedAt = performance.now()
      const result = collectLassoResult(polygon, objectCandidates, anchorCandidates)
      return { elapsedMs: performance.now() - startedAt, result }
    })
    const fastest = samples.reduce((best, sample) =>
      sample.elapsedMs < best.elapsedMs ? sample : best,
    )

    expect(fastest.result.filter((hit) => hit.kind === 'top-level')).toHaveLength(300)
    expect(fastest.result.filter((hit) => hit.kind === 'anchor')).toHaveLength(600)
    expect(fastest.result).toHaveLength(900)
    expect(fastest.elapsedMs).toBeLessThan(100)
  })
})
