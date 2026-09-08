/**
 * A catch-all, which on Vercel matches only a SINGLE path segment. That is
 * fine here — every auth route is one segment (login, callback, logout, me) —
 * but a two-segment route added under /api/auth/ would 404 at the platform
 * before reaching this handler. See api/anthropic/v1/messages.ts, where that
 * limit did bite.
 */
import { handleAuthApi } from '../_lib/authApi'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  return (await handleAuthApi(request, process.env)) ?? new Response('Not found', { status: 404 })
}
