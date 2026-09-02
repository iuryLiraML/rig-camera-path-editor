/**
 * Google OAuth login, restricted to one email domain — separate from, and
 * unrelated to, the in-app GoogleSignInButton/useCloudAuthStore flow (that
 * one connects the Director to the private cloud backend; this one gates
 * the whole site at the edge). No database: identity comes from Google,
 * "who's allowed" is one env var, and the session is a signed cookie.
 *
 * Routes:
 *   GET /api/auth/login     -> redirect to Google's consent screen
 *   GET /api/auth/callback  -> exchange the code, check the email, set the session cookie
 *   GET /api/auth/logout    -> clear the session cookie
 *
 * Pure Web-API (Request/Response), same router on Vercel Edge Functions and
 * the Vite dev server, matching api/_lib/agentApi.ts.
 */

import { clearSessionCookie, clearStateCookie, createSessionCookie, createStateCookie, randomState, readState } from './session'

export type AuthEnv = Partial<Record<string, string>>

const DEFAULT_ALLOWED_DOMAIN = 'silverside.ai'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

function textResponse(status: number, body: string, cookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'text/plain; charset=utf-8' })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(body, { status, headers })
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(null, { status: 302, headers })
}

/** The redirect_uri must match, byte-for-byte, whatever was registered in Google Cloud Console. */
function redirectUriFor(request: Request): string {
  return `${new URL(request.url).origin}/api/auth/callback`
}

/** Reads the email out of a Google ID token. No signature check needed here — we obtained this
 *  token ourselves, server-to-server, over a channel already authenticated with our client secret. */
function decodeIdTokenEmail(idToken: string): { email: string; emailVerified: boolean } | null {
  const parts = idToken.split('.')
  if (parts.length !== 3) return null
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(json) as { email?: string; email_verified?: boolean }
    if (!payload.email) return null
    return { email: payload.email, emailVerified: payload.email_verified === true }
  } catch {
    return null
  }
}

/** Only "/" or a same-origin path — never redirect off-site with a value that rode in on a query string. */
function safeReturnTo(value: string | undefined | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

async function handleLogin(request: Request, env: AuthEnv): Promise<Response> {
  const clientId = env.GOOGLE_CLIENT_ID
  if (!clientId) return textResponse(503, 'Google sign-in is not configured.')

  const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'))
  const nonce = randomState()

  const authUrl = new URL(GOOGLE_AUTH_URL)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUriFor(request))
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid email')
  authUrl.searchParams.set('prompt', 'select_account')
  authUrl.searchParams.set('state', JSON.stringify({ nonce, returnTo }))

  return redirect(authUrl.toString(), [createStateCookie(nonce)])
}

async function handleCallback(request: Request, env: AuthEnv): Promise<Response> {
  const clientId = env.GOOGLE_CLIENT_ID
  const clientSecret = env.GOOGLE_CLIENT_SECRET
  const sessionSecret = env.SESSION_SECRET
  if (!clientId || !clientSecret || !sessionSecret) {
    return textResponse(503, 'Google sign-in is not fully configured.')
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  if (!code || !stateParam) return textResponse(400, 'Missing code or state.')

  let nonce = ''
  let returnTo = '/'
  try {
    const parsed = JSON.parse(stateParam) as { nonce?: string; returnTo?: string }
    nonce = parsed.nonce ?? ''
    returnTo = safeReturnTo(parsed.returnTo)
  } catch {
    return textResponse(400, 'Invalid state.')
  }

  const expectedNonce = readState(request.headers.get('cookie'))
  if (!expectedNonce || !nonce || expectedNonce !== nonce) {
    return textResponse(400, 'That sign-in link expired or was already used — please try again.', [
      clearStateCookie(),
    ])
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUriFor(request),
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenResponse.ok) {
    return textResponse(502, 'Google sign-in failed — please try again.', [clearStateCookie()])
  }

  const tokenBody = (await tokenResponse.json()) as { id_token?: string }
  const identity = tokenBody.id_token ? decodeIdTokenEmail(tokenBody.id_token) : null
  if (!identity) {
    return textResponse(502, 'Could not read your Google account. Please try again.', [clearStateCookie()])
  }

  const allowedDomain = (env.ALLOWED_EMAIL_DOMAIN || DEFAULT_ALLOWED_DOMAIN).toLowerCase()
  const emailDomain = identity.email.split('@')[1]?.toLowerCase()
  if (!identity.emailVerified || emailDomain !== allowedDomain) {
    return textResponse(
      403,
      `${identity.email} isn't a @${allowedDomain} account. Sign in with your @${allowedDomain} Google account instead.`,
      [clearStateCookie()],
    )
  }

  const sessionCookie = await createSessionCookie(identity.email, sessionSecret)
  return redirect(returnTo, [sessionCookie, clearStateCookie()])
}

function handleLogout(): Response {
  return redirect('/', [clearSessionCookie()])
}

/** Route an /api/auth/* request. Returns null when the path isn't one of ours. */
export async function handleAuthApi(request: Request, env: AuthEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (request.method !== 'GET') return null

  if (path === '/api/auth/login') return handleLogin(request, env)
  if (path === '/api/auth/callback') return handleCallback(request, env)
  if (path === '/api/auth/logout') return handleLogout()
  return null
}
