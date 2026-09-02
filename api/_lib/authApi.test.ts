import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleAuthApi } from './authApi'
import { createSessionCookie, createStateCookie, signValue } from './session'

const ENV = {
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  SESSION_SECRET: 'test-session-secret',
}

function fakeIdToken(claims: Record<string, unknown>): string {
  const seg = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return `${seg({ alg: 'RS256' })}.${seg(claims)}.fake-signature`
}

describe('handleAuthApi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ignores non-auth routes', async () => {
    const res = await handleAuthApi(new Request('http://localhost/api/agent-config'), ENV)
    expect(res).toBeNull()
  })

  it('ignores non-GET requests', async () => {
    const res = await handleAuthApi(new Request('http://localhost/api/auth/login', { method: 'POST' }), ENV)
    expect(res).toBeNull()
  })

  describe('/api/auth/login', () => {
    it('503s when Google is not configured', async () => {
      const res = await handleAuthApi(new Request('http://localhost/api/auth/login'), {})
      expect(res?.status).toBe(503)
    })

    it('redirects to Google with the right params and sets a state cookie', async () => {
      const res = await handleAuthApi(
        new Request('http://localhost/api/auth/login?returnTo=%2Fcompose'),
        ENV,
      )
      expect(res?.status).toBe(302)
      const location = new URL(res!.headers.get('location')!)
      expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
      expect(location.searchParams.get('client_id')).toBe(ENV.GOOGLE_CLIENT_ID)
      expect(location.searchParams.get('redirect_uri')).toBe('http://localhost/api/auth/callback')
      expect(location.searchParams.get('response_type')).toBe('code')
      expect(location.searchParams.get('scope')).toBe('openid email')
      const state = JSON.parse(location.searchParams.get('state')!)
      expect(state.returnTo).toBe('/compose')
      expect(typeof state.nonce).toBe('string')
      expect(res?.headers.get('set-cookie')).toContain('rig_oauth_state=')
    })

    it('never carries an off-site returnTo through to Google', async () => {
      const res = await handleAuthApi(
        new Request('http://localhost/api/auth/login?returnTo=https://evil.example.com'),
        ENV,
      )
      const location = new URL(res!.headers.get('location')!)
      const state = JSON.parse(location.searchParams.get('state')!)
      expect(state.returnTo).toBe('/')
    })
  })

  describe('/api/auth/callback', () => {
    it('400s when code or state is missing', async () => {
      const res = await handleAuthApi(new Request('http://localhost/api/auth/callback'), ENV)
      expect(res?.status).toBe(400)
    })

    it('400s on a state mismatch and clears the state cookie', async () => {
      const res = await handleAuthApi(
        new Request('http://localhost/api/auth/callback?code=abc&state=' + encodeURIComponent(JSON.stringify({ nonce: 'a', returnTo: '/' })), {
          headers: { cookie: createStateCookie('different-nonce').split(';')[0] },
        }),
        ENV,
      )
      expect(res?.status).toBe(400)
      expect(res?.headers.get('set-cookie')).toContain('Max-Age=0')
    })

    it('502s when the Google token exchange fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 400 })))
      const nonce = 'matching-nonce'
      const state = encodeURIComponent(JSON.stringify({ nonce, returnTo: '/' }))
      const res = await handleAuthApi(
        new Request(`http://localhost/api/auth/callback?code=abc&state=${state}`, {
          headers: { cookie: createStateCookie(nonce).split(';')[0] },
        }),
        ENV,
      )
      expect(res?.status).toBe(502)
    })

    it('403s a verified email outside the allowed domain, without setting a session cookie', async () => {
      const idToken = fakeIdToken({ email: 'someone@gmail.com', email_verified: true })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ id_token: idToken }), { status: 200 })),
      )
      const nonce = 'matching-nonce'
      const state = encodeURIComponent(JSON.stringify({ nonce, returnTo: '/' }))
      const res = await handleAuthApi(
        new Request(`http://localhost/api/auth/callback?code=abc&state=${state}`, {
          headers: { cookie: createStateCookie(nonce).split(';')[0] },
        }),
        ENV,
      )
      expect(res?.status).toBe(403)
      expect(res?.headers.get('set-cookie')).not.toContain('rig_session=')
    })

    it('rejects an unverified email even on the right domain', async () => {
      const idToken = fakeIdToken({ email: 'tim@silverside.ai', email_verified: false })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ id_token: idToken }), { status: 200 })),
      )
      const nonce = 'matching-nonce'
      const state = encodeURIComponent(JSON.stringify({ nonce, returnTo: '/' }))
      const res = await handleAuthApi(
        new Request(`http://localhost/api/auth/callback?code=abc&state=${state}`, {
          headers: { cookie: createStateCookie(nonce).split(';')[0] },
        }),
        ENV,
      )
      expect(res?.status).toBe(403)
    })

    it('accepts a verified @silverside.ai email and sets the session cookie', async () => {
      const idToken = fakeIdToken({ email: 'tim@silverside.ai', email_verified: true })
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id_token: idToken }), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const nonce = 'matching-nonce'
      const state = encodeURIComponent(JSON.stringify({ nonce, returnTo: '/compose' }))
      const res = await handleAuthApi(
        new Request(`http://localhost/api/auth/callback?code=abc&state=${state}`, {
          headers: { cookie: createStateCookie(nonce).split(';')[0] },
        }),
        ENV,
      )
      expect(res?.status).toBe(302)
      expect(res?.headers.get('location')).toBe('/compose')
      const cookies = res!.headers.getSetCookie()
      expect(cookies.some((c) => c.includes('rig_session='))).toBe(true)
      expect(cookies.some((c) => c.includes('rig_oauth_state=') && c.includes('Max-Age=0'))).toBe(true)

      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      const body = new URLSearchParams(init.body as string)
      expect(body.get('client_secret')).toBe(ENV.GOOGLE_CLIENT_SECRET)
      expect(body.get('grant_type')).toBe('authorization_code')
    })

    it('respects a custom ALLOWED_EMAIL_DOMAIN', async () => {
      const idToken = fakeIdToken({ email: 'guest@partner.example', email_verified: true })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ id_token: idToken }), { status: 200 })),
      )
      const nonce = 'matching-nonce'
      const state = encodeURIComponent(JSON.stringify({ nonce, returnTo: '/' }))
      const res = await handleAuthApi(
        new Request(`http://localhost/api/auth/callback?code=abc&state=${state}`, {
          headers: { cookie: createStateCookie(nonce).split(';')[0] },
        }),
        { ...ENV, ALLOWED_EMAIL_DOMAIN: 'partner.example' },
      )
      expect(res?.status).toBe(302)
    })
  })

  describe('/api/auth/logout', () => {
    // a page, not a redirect: "/" would bounce back through the gate to Google,
    // which — with the Google session still alive — lands the user in the app
    // again and makes sign-out look broken
    it('clears the session cookie and renders a signed-out page', async () => {
      const res = await handleAuthApi(new Request('http://localhost/api/auth/logout'), ENV)
      expect(res?.status).toBe(200)
      expect(res?.headers.get('location')).toBeNull()
      expect(res?.headers.get('content-type')).toContain('text/html')
      expect(res?.headers.get('cache-control')).toBe('no-store')
      expect(res?.headers.get('set-cookie')).toContain('Max-Age=0')

      const html = await res!.text()
      expect(html).toContain('signed out')
      expect(html).toContain('/api/auth/login')
    })

    it('works with nothing configured — the page must be reachable to fix a broken gate', async () => {
      const res = await handleAuthApi(new Request('http://localhost/api/auth/logout'), {})
      expect(res?.status).toBe(200)
      expect(res?.headers.get('set-cookie')).toContain('Max-Age=0')
    })
  })

  describe('/api/auth/me', () => {
    const cookieFor = async (email: string, secret: string) =>
      (await createSessionCookie(email, secret)).split(';')[0]

    const me = (cookie?: string, env: typeof ENV | Record<string, string> = ENV) =>
      handleAuthApi(
        new Request('http://localhost/api/auth/me', { headers: cookie ? { cookie } : {} }),
        env,
      )

    it('returns the email for a valid session cookie', async () => {
      const res = await me(await cookieFor('tim@silverside.ai', ENV.SESSION_SECRET))
      expect(res?.status).toBe(200)
      expect(await res!.json()).toEqual({ email: 'tim@silverside.ai' })
    })

    it('never caches — a stale "signed in" answer would outlive the session', async () => {
      const res = await me(await cookieFor('tim@silverside.ai', ENV.SESSION_SECRET))
      expect(res?.headers.get('cache-control')).toBe('no-store')
      expect(res?.headers.get('content-type')).toContain('application/json')
    })

    it('returns null with no cookie at all', async () => {
      expect(await (await me())!.json()).toEqual({ email: null })
    })

    it('returns null for a cookie signed with a different secret', async () => {
      const res = await me(await cookieFor('tim@silverside.ai', 'some-other-secret'))
      expect(await res!.json()).toEqual({ email: null })
    })

    // the payload is base64url JSON, so swap the whole segment and keep the
    // original signature — that's the attack the HMAC exists to stop
    it('returns null when the payload is swapped but the signature is kept', async () => {
      const cookie = await cookieFor('tim@silverside.ai', ENV.SESSION_SECRET)
      const signature = cookie.slice(cookie.indexOf('.') + 1)
      const forged = Buffer.from(
        JSON.stringify({ email: 'attacker@example.com', exp: Math.floor(Date.now() / 1000) + 999 }),
      ).toString('base64url')
      const res = await me(`rig_session=${forged}.${signature}`)
      expect(await res!.json()).toEqual({ email: null })
    })

    it('returns null for a correctly signed but expired session', async () => {
      const token = await signValue(
        { email: 'tim@silverside.ai', exp: Math.floor(Date.now() / 1000) - 1 },
        ENV.SESSION_SECRET,
      )
      expect(await (await me(`rig_session=${token}`))!.json()).toEqual({ email: null })
    })

    // "no gate configured" and "not signed in" are the same answer on purpose:
    // the client shows no sign-out control either way, so ungated local dev stays clean
    it('returns null rather than 503 when SESSION_SECRET is missing', async () => {
      const res = await me(await cookieFor('tim@silverside.ai', ENV.SESSION_SECRET), {})
      expect(res?.status).toBe(200)
      expect(await res!.json()).toEqual({ email: null })
    })
  })
})
