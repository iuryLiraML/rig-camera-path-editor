/**
 * One file per allowlisted vendor path, deliberately static.
 *
 * This was a `[...path].ts` catch-all, which on Vercel matched only a SINGLE
 * segment: `/api/anthropic/v1` reached the handler but `/api/anthropic/v1/messages`
 * returned the platform's own NOT_FOUND, so every Director call 404'd in
 * production. Static files have no such limit, and the set of files here
 * mirrors `allowedPaths` in _lib/agentApi.ts — adding a vendor path means
 * adding both.
 */
import { handleAgentApi } from '../../_lib/agentApi'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  return (await handleAgentApi(request, process.env)) ?? new Response('Not found', { status: 404 })
}
