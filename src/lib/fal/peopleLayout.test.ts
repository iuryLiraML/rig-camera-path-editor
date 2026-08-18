import { describe, expect, it } from 'vitest'
import { layoutPeoplePositions, personObjectName } from './peopleLayout'

describe('layoutPeoplePositions', () => {
  it('keeps a single person on the origin', () => {
    expect(layoutPeoplePositions(1)).toEqual([[0, 0, 0]])
  })

  it('spreads several people on X so they can be posed separately', () => {
    expect(layoutPeoplePositions(3)).toEqual([
      [-1.8, 0, 0],
      [0, 0, 0],
      [1.8, 0, 0],
    ])
  })

  it('orders slots left-to-right from SAM box centers', () => {
    const boxes = [
      [0.8, 0.5, 0.2, 0.4],
      [0.2, 0.5, 0.2, 0.4],
    ]
    expect(layoutPeoplePositions(2, boxes)).toEqual([
      [0.9, 0, 0],
      [-0.9, 0, 0],
    ])
  })
})

describe('personObjectName', () => {
  it('numbers a group and leaves a solo figure unnumbered', () => {
    expect(personObjectName(0, 1)).toBe('Person')
    expect(personObjectName(0, 2)).toBe('Person 1')
    expect(personObjectName(1, 2)).toBe('Person 2')
  })
})
