import { afterEach, describe, expect, it } from 'vitest'
import { providerRequest, providerUsable } from './providers'
import { setServerKeysForTests } from './serverKeys'

afterEach(() => setServerKeysForTests(null))

describe('providerRequest', () => {
  it('always uses the same-origin proxy and sends no credentials', () => {
    // the whole point of dropping BYOK: there is no code path that can put a
    // vendor key in a browser request, with or without a site key configured
    expect(providerRequest('anthropic', 'v1/messages')).toEqual({
      url: '/api/anthropic/v1/messages',
    })

    setServerKeysForTests({ anthropic: true, fal: false })
    expect(providerRequest('anthropic', 'v1/models?limit=100')).toEqual({
      url: '/api/anthropic/v1/models?limit=100',
    })
  })
})

describe('providerUsable', () => {
  it('follows the deployment site key, since there is no personal key to fall back on', () => {
    expect(providerUsable('anthropic')).toBe(false)

    setServerKeysForTests({ anthropic: true, fal: false })
    expect(providerUsable('anthropic')).toBe(true)
  })
})
