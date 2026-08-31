import { describe, expect, it } from 'vitest'
import { tripoSplatFrameRect, tripoSplatUserError } from './tripoSplatFrame'

describe('tripoSplatFrameRect', () => {
  it('adds a rembg-safe border around a landscape still', () => {
    const framed = tripoSplatFrameRect(1920, 1080)
    expect(framed.pad).toBe(Math.round(1920 * 0.18))
    expect(framed.width).toBe(1920 + framed.pad * 2)
    expect(framed.height).toBe(1080 + framed.pad * 2)
  })

  it('never uses a sliver that rembg can ignore', () => {
    expect(tripoSplatFrameRect(8, 8).pad).toBeGreaterThanOrEqual(24)
  })
})

describe('tripoSplatUserError', () => {
  it('rewrites the Fal rembg refusal that room stills hit', () => {
    expect(
      tripoSplatUserError(
        'No foreground subject could be detected in the input image after background removal. Provide an image with a clear, visible subject against a plain or distinct background.',
      ),
    ).toMatch(/frames the photo/)
  })

  it('leaves other Fal errors alone', () => {
    expect(tripoSplatUserError('NSFW content detected')).toBe('NSFW content detected')
  })
})
