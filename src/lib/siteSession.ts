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
export interface SiteSession {
  email: string | null
  loginConfigured: boolean
}

export async function fetchSiteSession(): Promise<SiteSession> {
  try {
    const res = await fetch('/api/auth/me')
    if (!res.ok) throw new Error('Sign-in is temporarily unavailable. Please try again.')
    const body = (await res.json()) as { email?: unknown; loginConfigured?: unknown }
    return {
      email: typeof body.email === 'string' && body.email ? body.email : null,
      loginConfigured: body.loginConfigured === true,
    }
  } catch {
    // offline, or a deployment without the auth routes
    throw new Error('Sign-in is temporarily unavailable. Please try again.')
  }
}

export async function fetchSessionEmail(): Promise<string | null> {
  return (await fetchSiteSession().catch(() => null))?.email ?? null
}

/** Complete the local write before leaving the editor for an OAuth navigation. */
export async function navigateToSiteAuth(action: 'login' | 'logout'): Promise<void> {
  const [{ flushActiveProject }, { useSaveStatusStore }] = await Promise.all([
    import('./projects'), import('./saveStatus'),
  ])
  await flushActiveProject({ createIfMissing: useSaveStatusStore.getState().status === 'dirty' })
  window.location.assign(`/api/auth/${action}`)
}
