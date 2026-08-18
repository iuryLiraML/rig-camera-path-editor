import { describe, expect, it } from 'vitest'
import {
  add3,
  applyObjectDrag,
  hitOnPlane,
  objectDragMode,
  objectDragPlane,
  snapObjectDrag,
  snapVec3,
  subtract3,
  truckOnGround,
} from './planeDrag'

describe('hitOnPlane', () => {
  it('hits the XZ ground from above', () => {
    const hit = hitOnPlane([0, 5, 0], [0, -1, 0], [0, 0, 0], [0, 1, 0])
    expect(hit).not.toBeNull()
    expect(hit![1]).toBeCloseTo(0, 6)
    expect(hit![0]).toBeCloseTo(0, 6)
  })

  it('returns null when the ray is parallel to the plane', () => {
    expect(hitOnPlane([0, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0])).toBeNull()
  })

  it('returns null when the plane is behind the ray', () => {
    expect(hitOnPlane([0, 1, 0], [0, 1, 0], [0, 0, 0], [0, 1, 0])).toBeNull()
  })
})

describe('vec3 helpers', () => {
  it('adds and subtracts component-wise', () => {
    expect(add3([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9])
    expect(subtract3([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3])
  })
})

describe('snapVec3', () => {
  it('snaps all axes or keeps Y when locking to XZ', () => {
    expect(snapVec3([0.24, 1.11, 0.76], 0.5, 'xyz')).toEqual([0, 1, 1])
    expect(snapVec3([0.24, 1.11, 0.76], 0.5, 'xz')).toEqual([0, 1.11, 1])
  })
})

describe('object mesh drag', () => {
  it('uses the floor unless Shift lifts on Y', () => {
    expect(objectDragMode(false)).toBe('ground')
    expect(objectDragMode(true)).toBe('lift')
    expect(objectDragPlane([1, 2, 3], [0, -1, 0], 'ground').normal).toEqual([0, 1, 0])
    expect(objectDragPlane([1, 2, 3], [0.6, -0.2, 0.8], 'lift').normal[1]).toBe(0)
  })

  it('keeps height on the floor and XZ when lifting', () => {
    expect(applyObjectDrag([4, 9, 7], [0, 0, 0], [1, 2, 3], 'ground')).toEqual([4, 2, 7])
    expect(applyObjectDrag([4, 9, 7], [0, 0, 0], [1, 2, 3], 'lift')).toEqual([1, 9, 3])
  })

  it('snaps only the live axes', () => {
    expect(snapObjectDrag([0.24, 1.11, 0.76], 0.5, 'ground')).toEqual([0, 1.11, 1])
    expect(snapObjectDrag([0.24, 1.11, 0.76], 0.5, 'lift')).toEqual([0.24, 1, 0.76])
  })
})

describe('truckOnGround', () => {
  it('slides camera and target on XZ and keeps their heights', () => {
    const next = truckOnGround([2, 3, 4], [8, 1, 0], [2, 0, 4], [5, 0, 1])
    expect(next.camera).toEqual([5, 3, 1])
    expect(next.target).toEqual([11, 1, -3])
  })
})
