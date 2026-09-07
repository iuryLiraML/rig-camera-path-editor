// Vercel Edge Middleware — HTTP Basic Auth gate for the whole site.
//
// The password is NEVER stored in this file or the repo. It is read at the
// edge from Vercel Environment Variables:
//   SITE_USER      — the username (e.g. "silverside")
//   SITE_PASSWORD  — the shared password
//
// Safe default: if either variable is missing, the gate is disabled and the
// site stays open (so a missing env var can never lock everyone out).
//
// Runs before every static asset is served, so once the browser has
// authenticated it sends the credentials automatically for the whole origin.

export const config = { matcher: '/:path*' }

export default function middleware(request: Request): Response | undefined {
  const user = process.env.SITE_USER
  const password = process.env.SITE_PASSWORD

  // no credentials configured -> do not lock anyone out
  if (!user || !password) return undefined

  const header = request.headers.get('authorization') ?? ''
  const [scheme, encoded] = header.split(' ')

  if (scheme === 'Basic' && encoded) {
    let decoded = ''
    try {
      decoded = atob(encoded)
    } catch {
      decoded = ''
    }
    const sep = decoded.indexOf(':')
    const givenUser = decoded.slice(0, sep)
    const givenPass = decoded.slice(sep + 1)
    if (givenUser === user && givenPass === password) {
      return undefined // credentials match -> continue to the site
    }
  }

  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Rig — Silverside", charset="UTF-8"',
    },
  })
}
