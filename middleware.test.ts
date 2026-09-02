import { afterEach, describe, expect, it, vi } from 'vitest'
import middleware from './middleware'
import { createSessionCookie } from './api/_lib/session'

const basicAuthHeader = (user: string, pass: string) => `Basic ${btoa(`${user}:${pass}`)}`
const navigationInit: RequestInit = { headers: { 'sec-fetch-mode': 'navigate' } }

afterEach(() => vi.unstubAllEnvs())

describe('middleware — nothing configured', () => {
  it('stays open so a missing env var can never lock everyone out', async () => {
    const res = await middleware(new Request('http://localhost/', navigationInit))
    expect(res).toBeUndefined()
  })
})

describe('middleware — /api/auth/* is never gated', () => {
  it('bypasses even with both mechanisms configured and no credentials supplied', async () => {
    vi.stubEnv('SITE_USER', 'u')
    vi.stubEnv('SITE_PASSWORD', 'p')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('SESSION_SECRET', 'secret')
    const res = await middleware(new Request('http://localhost/api/auth/login', navigationInit))
    expect(res).toBeUndefined()
  })
})

describe('middleware — Basic Auth only', () => {
  it('passes with the right credentials', async () => {
    vi.stubEnv('SITE_USER', 'silverside')
    vi.stubEnv('SITE_PASSWORD', 'hunter2')
    const res = await middleware(
      new Request('http://localhost/', {
        headers: { ...navigationInit.headers, authorization: basicAuthHeader('silverside', 'hunter2') },
      }),
    )
    expect(res).toBeUndefined()
  })

  it('challenges with WWW-Authenticate when credentials are wrong or missing', async () => {
    vi.stubEnv('SITE_USER', 'silverside')
    vi.stubEnv('SITE_PASSWORD', 'hunter2')
    const res = await middleware(new Request('http://localhost/', navigationInit))
    expect(res?.status).toBe(401)
    expect(res?.headers.get('WWW-Authenticate')).toContain('Basic')
  })
})

describe('middleware — Google session only', () => {
  it('passes with a valid session cookie', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('SESSION_SECRET', 'secret')
    const cookie = (await createSessionCookie('tim@silverside.ai', 'secret')).split(';')[0]
    const res = await middleware(
      new Request('http://localhost/', { headers: { ...navigationInit.headers, cookie } }),
    )
    expect(res).toBeUndefined()
  })

  it('rejects a session cookie signed with a different secret (non-navigation request)', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('SESSION_SECRET', 'secret')
    const cookie = (await createSessionCookie('tim@silverside.ai', 'wrong-secret')).split(';')[0]
    const res = await middleware(new Request('http://localhost/api/agent-config', { headers: { cookie } }))
    expect(res?.status).toBe(401) // no Basic Auth configured, so no WWW-Authenticate challenge either
    expect(res?.headers.get('WWW-Authenticate')).toBeNull()
  })

  it('a tampered session cookie on a navigation still redirects to login, not a 401', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('SESSION_SECRET', 'secret')
    const cookie = (await createSessionCookie('tim@silverside.ai', 'wrong-secret')).split(';')[0]
    const res = await middleware(
      new Request('http://localhost/', { headers: { ...navigationInit.headers, cookie } }),
    )
    expect(res?.status).toBe(302)
  })

  it('redirects a real navigation to /api/auth/login with returnTo, when logged out', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('SESSION_SECRET', 'secret')
    const res = await middleware(new Request('http://localhost/compose?tab=camera', navigationInit))
    expect(res?.status).toBe(302)
    const location = new URL(res!.headers.get('location')!)
    expect(location.pathname).toBe('/api/auth/login')
    expect(location.searchParams.get('returnTo')).toBe('/compose?tab=camera')
  })

  it('401s a non-navigation request instead of redirecting, when logged out', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('SESSION_SECRET', 'secret')
    const res = await middleware(new Request('http://localhost/api/agent-config'))
    expect(res?.status).toBe(401)
    expect(res?.headers.get('location')).toBeNull()
  })

  it('redirects an iframed preview too — Sec-Fetch-Mode: nested-navigate, not just "navigate"', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('SESSION_SECRET', 'secret')
    const res = await middleware(
      new Request('http://localhost/', { headers: { 'sec-fetch-mode': 'nested-navigate' } }),
    )
    expect(res?.status).toBe(302)
  })

  it('falls back to the Accept header when a browser sends no Sec-Fetch-Mode at all', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('SESSION_SECRET', 'secret')
    const res = await middleware(
      new Request('http://localhost/', { headers: { accept: 'text/html,application/xhtml+xml' } }),
    )
    expect(res?.status).toBe(302)
  })

  it('does not redirect a same-origin fetch() just because Accept happens to include */*', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('SESSION_SECRET', 'secret')
    const res = await middleware(
      new Request('http://localhost/api/agent-config', {
        headers: { 'sec-fetch-mode': 'cors', accept: '*/*' },
      }),
    )
    expect(res?.status).toBe(401)
  })
})

describe('middleware — both configured (break-glass fallback)', () => {
  it('Basic Auth alone is enough even with no session cookie', async () => {
    vi.stubEnv('SITE_USER', 'silverside')
    vi.stubEnv('SITE_PASSWORD', 'hunter2')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('SESSION_SECRET', 'secret')
    const res = await middleware(
      new Request('http://localhost/', {
        headers: { ...navigationInit.headers, authorization: basicAuthHeader('silverside', 'hunter2') },
      }),
    )
    expect(res).toBeUndefined()
  })

  it('a Google session alone is enough even with no Basic Auth header', async () => {
    vi.stubEnv('SITE_USER', 'silverside')
    vi.stubEnv('SITE_PASSWORD', 'hunter2')
    vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id')
    vi.stubEnv('SESSION_SECRET', 'secret')
    const cookie = (await createSessionCookie('tim@silverside.ai', 'secret')).split(';')[0]
    const res = await middleware(
      new Request('http://localhost/', { headers: { ...navigationInit.headers, cookie } }),
    )
    expect(res).toBeUndefined()
  })
})
