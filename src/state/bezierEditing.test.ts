import { beforeEach, describe, expect, it } from 'vitest'
import { makeAnchor, usePathStore } from './usePathStore'
import { buildCurve, computeAutoHandles } from '../lib/curve'
import { moveBezierSegment } from '../lib/bezierEditing'

const path = () => usePathStore.getState()
const active = () => path().getPath(path().activePathId)!

beforeEach(() => {
  path().setPath([[0, 0, 0], [3, 0, 0], [12, 0, 0]], false)
})

describe('Bézier types and topology', () => {
  it('reopens a closed path when deletion leaves too few points to form a curve', () => {
    path().setClosed(true)
    path().removeAnchors(active().anchors.map(a => a.id))
    expect(active().closed).toBe(false)
    expect(active().anchors).toHaveLength(0)
  })
  it('Aligned preserves the opposite length while Free leaves its position alone', () => {
    const id = active().anchors[1].id
    path().setAnchorTangent(id, 'aligned')
    const len = Math.hypot(...active().anchors[1].handleIn)
    path().setHandle(id, 'out', [0, 3, 0], false)
    expect(active().anchors[1].handleIn[1]).toBeCloseTo(-len)
    path().setAnchorTangent(id, 'free')
    path().setHandle(id, 'out', [2, 4, 1], false)
    expect(active().anchors[1].handleIn[1]).toBeCloseTo(-len)
  })

  it('Vector controls follow their neighbors and become Free when pulled', () => {
    const id = active().anchors[1].id
    path().setAnchorTangent(id, 'vector')
    const resolved = computeAutoHandles(active().anchors, false, .8)[1]
    expect(resolved.handleIn).toEqual([-1, 0, 0])
    expect(resolved.handleOut).toEqual([3, 0, 0])
    path().setHandle(id, 'out', [3, 1, 0], false)
    expect(active().anchors[1].handleOutType).toBe('free')
    expect(computeAutoHandles(active().anchors, false, .8)[1].handleIn).toEqual([-1, 0, 0])
  })

  for (const closed of [false, true]) {
    it(`splits ${closed ? 'the closing' : 'an open'} segment without changing any part of the curve`, () => {
      path().setPath([[0, 0, 0], [3, 2, 1], [12, 0, 4]], closed)
      const original = buildCurve(active().anchors, closed, .8)!
      const index = closed ? 2 : 0
      const split = .37
      expect(path().splitSegment(index, split)).not.toBeNull()
      const after = buildCurve(active().anchors, closed, .8)!
      for (let segment = 0; segment < original.curves.length; segment++) {
        for (let sample = 0; sample <= 100; sample++) {
          const t = sample / 100
          const target = segment === index
            ? after.curves[index + (t > split ? 1 : 0)].getPoint(t > split ? (t - split) / (1 - split) : t / split)
            : after.curves[segment > index ? segment + 1 : segment].getPoint(t)
          expect(original.curves[segment].getPoint(t).distanceTo(target)).toBeLessThan(1e-9)
        }
      }
    })
  }

  it('moves the grabbed segment location by the requested delta with fixed anchors', () => {
    const before = buildCurve(active().anchors, false, .8)!.curves[0].getPoint(.3)
    const anchors = moveBezierSegment(active(), 0, .3, [1, 2, -3])
    const after = buildCurve(anchors, false, .8)!.curves[0].getPoint(.3)
    after.sub(before).toArray().forEach((v, i) => expect(v).toBeCloseTo([1, 2, -3][i], 10))
    expect(anchors.map(a => a.position)).toEqual(active().anchors.map(a => a.position))
  })

  it('preserves old manual controls when loading without explicit types', () => {
    const anchor = { ...makeAnchor([0, 0, 0]), manual: true, handleOut: [1, 2, 3] as [number, number, number] }
    path().setPathData(active().id, { anchors: [anchor, makeAnchor([4, 5, 6])] })
    expect(computeAutoHandles(active().anchors, false, .8)[0]).toEqual(anchor)
  })

  it('continues from either end without reversing existing control directions', () => {
    const before = active().anchors
    const id = path().extendAnchor([-2, 0, 0], true)
    expect(active().anchors[0].id).toBe(id)
    expect(active().anchors.slice(1)).toEqual(before)
    expect(path().selectedAnchorId).toBe(id)
  })
})

describe('editing the handles already displayed on a Bézier', () => {
  it('does not jump when an Auto handle starts moving at its displayed position', () => {
    const shown = computeAutoHandles(active().anchors, false, active().rounding)[1]
    path().setHandle(shown.id, 'out', shown.handleOut, false)
    expect(active().anchors[1].handleIn).toEqual(shown.handleIn)
  })

  it('keeps authored positions when switching to independent handles', () => {
    const id = active().anchors[1].id
    path().setHandle(id, 'out', [4, 2, 1], true)
    const before = active().anchors[1]
    path().setAnchorTangent(id, 'broken')
    expect(active().anchors[1].handleOut).toEqual(before.handleOut)
    expect(active().anchors[1].handleIn).toEqual(before.handleIn)
  })

  it('enables mirroring explicitly using the existing outgoing handle', () => {
    const id = active().anchors[1].id
    path().setHandle(id, 'out', [4, 2, 1], true)
    path().setAnchorTangent(id, 'smooth')
    expect(active().anchors[1].handleOut).toEqual([4, 2, 1])
    expect(active().anchors[1].handleIn).toEqual([-4, -2, -1])
  })
})
