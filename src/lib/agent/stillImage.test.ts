import { describe, expect, it } from 'vitest'
import { userTurnImage, visionForTurn } from './stillImage'

describe('userTurnImage', () => {
  it('sends the chat photo instead of the viewport screenshot', () => {
    const still = userTurnImage({
      chatPhoto: { data: 'photo-bytes', mediaType: 'image/jpeg' },
      screenshot: true,
      viewport: 'viewport-bytes',
    })
    expect(still).toEqual({ data: 'photo-bytes', mediaType: 'image/jpeg' })
  })

  it('falls back to the viewport only when no photo is attached', () => {
    expect(
      userTurnImage({
        chatPhoto: null,
        screenshot: true,
        viewport: 'viewport-bytes',
      }),
    ).toEqual({ data: 'viewport-bytes', mediaType: 'image/jpeg' })
  })

  it('sends nothing when screenshot is off and there is no photo', () => {
    expect(userTurnImage({ screenshot: false, viewport: 'viewport-bytes' })).toBeUndefined()
  })
})

describe('visionForTurn', () => {
  it('enables vision for a chat photo even when Screenshot is Off', () => {
    expect(
      visionForTurn({
        screenshotActive: false,
        hasChatPhoto: true,
        modelSupportsVision: true,
      }),
    ).toBe(true)
  })

  it('stays off on text-only models', () => {
    expect(
      visionForTurn({
        screenshotActive: true,
        hasChatPhoto: true,
        modelSupportsVision: false,
      }),
    ).toBe(false)
  })
})
