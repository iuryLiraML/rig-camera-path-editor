import { describe, expect, it } from 'vitest'
import { uniquePathName } from './pathName'

describe('uniquePathName', () => {
  const paths = [
    { id: 'a', name: 'Camera Path' },
    { id: 'b', name: 'Road' },
  ]

  it('keeps a free name', () => {
    expect(uniquePathName('Detour', paths)).toBe('Detour')
  })

  it('trims and rejects an empty name', () => {
    expect(uniquePathName('   ', paths)).toBe('Path')
  })

  it('suffixes on collision and ignores the path being renamed', () => {
    expect(uniquePathName('Road', paths)).toBe('Road 2')
    expect(uniquePathName('Road', paths, 'b')).toBe('Road')
    expect(uniquePathName('Road', [...paths, { id: 'c', name: 'Road 2' }])).toBe('Road 3')
  })

  it('suffixes a duplicate copy name that is already taken', () => {
    expect(
      uniquePathName('Road copy', [...paths, { id: 'c', name: 'Road copy' }]),
    ).toBe('Road copy 2')
  })
})
