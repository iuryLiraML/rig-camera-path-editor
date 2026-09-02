/**
 * Who the site-access session belongs to (the Google login gate in
 * middleware.ts / api/_lib/authApi.ts). The session cookie is HttpOnly, so
 * the only way to know is to ask the server.
 *
 * Unrelated to useCloudAuthStore — that's the Director's connection to the
 * private cloud backend, a different account with a different token.
 *
 * Any failure means "no session", which the UI reads as "no gate here" and
 * shows no sign-out control — so an ungated local deployment stays clean.
 */
export async function fetchSessionEmail(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/me')
    if (!res.ok) return null
    const body = (await res.json()) as { email?: unknown }
    return typeof body.email === 'string' && body.email ? body.email : null
  } catch {
    // offline, or a deployment without the auth routes
    return null
  }
}
