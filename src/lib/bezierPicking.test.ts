import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { pickBezier, viewDragPlane } from './bezierPicking'
import { makeAnchor, type MotionPath } from '../state/usePathStore'

describe('Bézier pointer targets', () => {
  const a = { ...makeAnchor([0, 0, 0]), manual: true, handleOut: [40, 0, 30] as [number, number, number] }
  const b = { ...makeAnchor([100, 0, 0]), manual: true, handleIn: [-40, 0, 30] as [number, number, number] }
  const path: MotionPath = { id: 'path', name: 'Path', anchors: [a, b], closed: false, rounding: .8 }
  const project = (v: [number, number, number]) => ({ x: v[0], y: v[2] })

  it('picks only visible handles and gives collapsed handles back to their anchor', () => {
    expect(pickBezier(path, { x: 40, y: 30 }, project, new Set([a.id]))).toMatchObject({ kind: 'handle', id: a.id, side: 'out' })
    expect(pickBezier(path, { x: 40, y: 30 }, project, new Set())).toBeNull()
    expect(pickBezier(path, { x: 0, y: 0 }, project, new Set([a.id]))).toMatchObject({ kind: 'anchor', id: a.id })
  })

  it('resolves the curve parameter from screen coordinates, including zoom', () => {
    const zoomed = (v: [number, number, number]) => ({ x: v[0] * 3, y: v[2] * 3 })
    const hit = pickBezier(path, { x: 150, y: 67.5 }, zoomed, new Set())
    expect(hit?.kind).toBe('segment')
    if (hit?.kind === 'segment') expect(hit.t).toBeCloseTo(.5, 4)
  })

  it('uses an exact axis plane in Top and the view plane in perspective', () => {
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(.001, 10, .001)
    camera.lookAt(0, 0, 0)
    expect(viewDragPlane(camera, [0, 2, 0]).normal.toArray()).toEqual([0, -1, 0])
    camera.position.set(5, 4, 6)
    camera.lookAt(0, 0, 0)
    expect(viewDragPlane(camera, [0, 2, 0]).normal.distanceTo(camera.getWorldDirection(new THREE.Vector3()))).toBeLessThan(1e-10)
  })
})
