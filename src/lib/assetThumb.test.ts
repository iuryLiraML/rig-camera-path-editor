import { describe, expect, it } from 'vitest'
import { assetThumbKind } from './assetThumb'

describe('assetThumbKind', () => {
  it('picks a type placeholder before a clay render exists', () => {
    expect(assetThumbKind({ rigKind: 'dummy' })).toBe('person')
    expect(assetThumbKind({ rigKind: 'sam-person' })).toBe('person')
    expect(assetThumbKind({ keepPoints: true, rigKind: 'none' })).toBe('points')
    expect(assetThumbKind({ rigKind: 'none' })).toBe('mesh')
  })
})
