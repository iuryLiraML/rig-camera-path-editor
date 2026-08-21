import { afterEach, describe, expect, it } from 'vitest'
import { preferredProvider, providerRequest, providerUsable } from './providers'
import { setServerKeysForTests } from './serverKeys'

afterEach(() => setServerKeysForTests(null))

describe('providerRequest', () => {
  it('goes directly to the vendor with auth headers when a personal key is set (BYOK)', () => {
    const req = providerRequest('anthropic', 'sk-ant-mine', 'v1/messages')
    expect(req.url).toBe('https://api.anthropic.com/v1/messages')
    expect(req.headers['x-api-key']).toBe('sk-ant-mine')
  })

  it('uses the same-origin proxy with no credentials when the key is empty', () => {
    expect(providerRequest('anthropic', '', 'v1/messages')).toEqual({
      url: '/api/anthropic/v1/messages',
      headers: {},
    })
    expect(providerRequest('kimi', '  ', 'v1/chat/completions')).toEqual({
      url: '/api/kimi/v1/chat/completions',
      headers: {},
    })
  })
})

describe('providerUsable', () => {
  it('is true with a personal key, a site key, or both — false with neither', () => {
    expect(providerUsable('anthropic', 'sk-ant-mine')).toBe(true)
    expect(providerUsable('anthropic', '')).toBe(false)

    setServerKeysForTests({ anthropic: true, kimi: false, fal: false })
    expect(providerUsable('anthropic', '')).toBe(true)
    expect(providerUsable('kimi', '')).toBe(false)
  })
})

describe('preferredProvider', () => {
  const empty = { anthropic: '', kimi: '' }

  it('keeps the current provider when it already has a site or personal key', () => {
    expect(
      preferredProvider('kimi', empty, { anthropic: true, kimi: true, fal: false }),
    ).toBe('kimi')
    expect(
      preferredProvider('anthropic', { anthropic: 'sk-ant', kimi: '' }, {
        anthropic: false,
        kimi: true,
        fal: false,
      }),
    ).toBe('anthropic')
  })

  it('switches to a provider that the deployment can actually serve', () => {
    expect(
      preferredProvider('anthropic', empty, { anthropic: false, kimi: true, fal: false }),
    ).toBe('kimi')
  })
})
