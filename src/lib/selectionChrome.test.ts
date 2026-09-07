import { describe, expect, it } from 'vitest'
import { objectSelectionChrome } from './selectionChrome'

describe('objectSelectionChrome', () => {
  it('turns on outline for a selected object without lifting clay emissive', () => {
    expect(objectSelectionChrome({ selected: true })).toEqual({
      outline: true,
      clayEmissive: 0,
    })
  })

  it('leaves unselected objects without outline or emissive', () => {
    expect(objectSelectionChrome({ selected: false })).toEqual({
      outline: false,
      clayEmissive: 0,
    })
  })
})
