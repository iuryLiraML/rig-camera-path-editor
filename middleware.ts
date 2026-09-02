// Vercel Edge Middleware — gate for the whole site. Two independent ways in:
//
//   1. A verified Google login, restricted to ALLOWED_EMAIL_DOMAIN
//      (see api/_lib/authApi.ts) — the primary path.
//   2. HTTP Basic Auth via SITE_USER / SITE_PASSWORD — a break-glass
//      fallback that still works if Google OAuth is ever misconfigured.
//
// Neither credential is stored in this file or the repo. Both are read at
// the edge from Vercel Environment Variables:
//   SITE_USER, SITE_PASSWORD   — the Basic Auth fallback
//   GOOGLE_CLIENT_ID           — presence gates whether Google login applies
//   SESSION_SECRET             — signs/verifies the session cookie
//
// Safe default: if nothing is configured at all, the gate is disabled and
// the site stays open (so a missing env var can never lock everyone out).

import { readSessionEmail } from './api/_lib/session'

export const config = { matcher: '/:path*' }

function checkBasicAuth(request: Request, user: string, password: string): boolean {
  const header = request.headers.get('authorization') ?? ''
  const [scheme, encoded] = header.split(' ')
  if (scheme !== 'Basic' || !encoded) return false

  let decoded = ''
  try {
    decoded = atob(encoded)
  } catch {
    return false
  }
  const sep = decoded.indexOf(':')
  return decoded.slice(0, sep) === user && decoded.slice(sep + 1) === password
}

export default async function middleware(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url)

  // never gate the auth routes themselves — that would either lock the
  // login flow behind Basic Auth, or create a redirect loop against itself
  if (url.pathname.startsWith('/api/auth/')) return undefined

  const siteUser = process.env.SITE_USER
  const sitePassword = process.env.SITE_PASSWORD
  const basicAuthConfigured = Boolean(siteUser && sitePassword)

  const googleClientId = process.env.GOOGLE_CLIENT_ID
  const sessionSecret = process.env.SESSION_SECRET
  const googleConfigured = Boolean(googleClientId && sessionSecret)

  // nothing set up -> do not lock anyone out
  if (!basicAuthConfigured && !googleConfigured) return undefined

  if (basicAuthConfigured && checkBasicAuth(request, siteUser!, sitePassword!)) return undefined

  if (googleConfigured) {
    const email = await readSessionEmail(request.headers.get('cookie'), sessionSecret!)
    if (email) return undefined
  }

  // only send navigations to Google when it's actually configured — otherwise
  // /api/auth/login itself has nothing to redirect to and would just 503
  if (googleConfigured && request.headers.get('sec-fetch-mode') === 'navigate') {
    const returnTo = url.pathname + url.search
    return Response.redirect(`${url.origin}/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`, 302)
  }

  return new Response('Authentication required.', {
    status: 401,
    headers: basicAuthConfigured
      ? { 'WWW-Authenticate': 'Basic realm="Rig - Silverside", charset="UTF-8"' }
      : {},
  })
}
