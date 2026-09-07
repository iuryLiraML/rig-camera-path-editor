import { describe, expect, it, vi } from 'vitest'
import {
  clearSessionCookie,
  clearStateCookie,
  createSessionCookie,
  createStateCookie,
  randomState,
  readSessionEmail,
  readState,
  signValue,
  verifySignedValue,
} from './session'

const SECRET = 'test-secret-do-not-use-in-prod'

describe('signValue / verifySignedValue', () => {
  it('round-trips a payload', async () => {
    const token = await signValue({ hello: 'world' }, SECRET)
    expect(await verifySignedValue<{ hello: string }>(token, SECRET)).toEqual({ hello: 'world' })
  })

  it('rejects a tampered payload', async () => {
    const token = await signValue({ email: 'tim@silverside.ai' }, SECRET)
    const [json, signature] = token.split('.')
    const tampered = `${json}extra.${signature}`
    expect(await verifySignedValue(tampered, SECRET)).toBeNull()
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signValue({ hello: 'world' }, SECRET)
    expect(await verifySignedValue(token, 'a-different-secret')).toBeNull()
  })

  it('rejects malformed tokens without throwing', async () => {
    expect(await verifySignedValue('not-a-token', SECRET)).toBeNull()
    expect(await verifySignedValue('', SECRET)).toBeNull()
  })
})

describe('session cookie', () => {
  it('creates a cookie that readSessionEmail accepts', async () => {
    const cookie = await createSessionCookie('tim@silverside.ai', SECRET)
    const value = cookie.split(';')[0]
    expect(await readSessionEmail(value, SECRET)).toBe('tim@silverside.ai')
  })

  it('is HttpOnly, Secure, and SameSite=Lax', async () => {
    const cookie = await createSessionCookie('tim@silverside.ai', SECRET)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('returns null for a missing cookie header', async () => {
    expect(await readSessionEmail(null, SECRET)).toBeNull()
    expect(await readSessionEmail('other_cookie=1', SECRET)).toBeNull()
  })

  it('returns null once the cookie has expired', async () => {
    vi.useFakeTimers()
    try {
      const cookie = await createSessionCookie('tim@silverside.ai', SECRET)
      const value = cookie.split(';')[0]
      vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000) // 31 days
      expect(await readSessionEmail(value, SECRET)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clearSessionCookie expires immediately', () => {
    expect(clearSessionCookie()).toContain('Max-Age=0')
  })
})

describe('state cookie (OAuth CSRF guard)', () => {
  it('round-trips through createStateCookie / readState', () => {
    const nonce = randomState()
    const cookie = createStateCookie(nonce).split(';')[0]
    expect(readState(cookie)).toBe(nonce)
  })

  it('randomState never repeats across calls', () => {
    const values = new Set(Array.from({ length: 20 }, () => randomState()))
    expect(values.size).toBe(20)
  })

  it('clearStateCookie expires immediately', () => {
    expect(clearStateCookie()).toContain('Max-Age=0')
  })
})
