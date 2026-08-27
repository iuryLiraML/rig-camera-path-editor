import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./fal/client', () => ({
  falUsable: vi.fn(() => false),
  configureFal: vi.fn(),
  uploadImage: vi.fn(async () => 'https://img'),
}))

vi.mock('./fal/segment', () => ({
  segmentImageWithFallback: vi.fn(),
}))

import { falUsable, uploadImage } from './fal/client'
import { segmentImageWithFallback } from './fal/segment'
import { detectObjectRows, detectPeopleRows } from './findObjects'

beforeEach(() => {
  vi.mocked(falUsable).mockReturnValue(false)
  vi.mocked(uploadImage).mockResolvedValue('https://img')
})

describe('detectObjectRows', () => {
  it('does not invent objects without Fal', async () => {
    await expect(detectObjectRows(new Blob(['x'], { type: 'image/jpeg' }))).resolves.toEqual([])
  })

  it('one row per SAM object mask', async () => {
    vi.mocked(falUsable).mockReturnValue(true)
    vi.mocked(segmentImageWithFallback).mockResolvedValue({
      maskUrl: 'https://a',
      maskUrls: ['https://a', 'https://b'],
      modelId: 'sam',
    })
    const rows = await detectObjectRows(new Blob(['x'], { type: 'image/jpeg' }))
    expect(rows.map((row) => row.kind)).toEqual(['object', 'object'])
    expect(rows.map((row) => row.name)).toEqual(['Object 1', 'Object 2'])
    expect(vi.mocked(segmentImageWithFallback).mock.calls[0]?.[0].prompt).toMatch(/Exclude person/i)
  })
})

describe('detectPeopleRows', () => {
  it('still offers a person row without Fal', async () => {
    const rows = await detectPeopleRows(new Blob(['x'], { type: 'image/jpeg' }))
    expect(rows.map((row) => row.name)).toEqual(['Person'])
  })
})
