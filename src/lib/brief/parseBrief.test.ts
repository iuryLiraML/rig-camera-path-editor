import { describe, expect, it } from 'vitest'
import { briefContentTypeFromFile, sha256HexFromBlob } from './parseBrief'

describe('brief parsing helpers', () => {
  it('maps supported brief extensions to content types', () => {
    expect(
      briefContentTypeFromFile(new File(['x'], 'launch-brief.pdf', { type: 'application/pdf' })),
    ).toBe('application/pdf')
    expect(
      briefContentTypeFromFile(new File(['x'], 'notes.md', { type: 'text/markdown' })),
    ).toBe('text/markdown')
    expect(briefContentTypeFromFile(new File(['x'], 'brief.pages'))).toBeNull()
  })

  it('hashes brief files deterministically', async () => {
    const file = new File(['camera brief'], 'brief.txt', { type: 'text/plain' })
    const first = await sha256HexFromBlob(file)
    const second = await sha256HexFromBlob(file)

    expect(first).toHaveLength(64)
    expect(first).toBe(second)
  })
})
