/**
 * Shared-key proxy for the AI vendors. The deployment holds one key per vendor
 * in server-side environment variables (never VITE_* — those are inlined into
 * the public bundle); the client calls these same-origin routes and the key is
 * attached here, so it never reaches the browser.
 *
 * Pure Web-API (Request/Response) so the exact same router runs on Vercel Edge
 * Functions in production and inside the Vite dev server middleware locally.
 *
 * Routes:
 *   GET  /api/agent-config          -> which vendors have a site key (booleans only)
 *   *    /api/anthropic/<path>      -> https://api.anthropic.com/<path>   (x-api-key)
 *   *    /api/fal/proxy             -> x-fal-target-url on *.fal.ai / *.fal.run (Key)
 *
 * The LLM paths are allowlisted so a shared key cannot be used to reach other
 * vendor endpoints (account, billing, …) through this proxy.
 */

export type ProxyEnv = Partial<Record<string, string>>

export const ENV_VARS = {
  anthropic: 'ANTHROPIC_API_KEY',
  fal: 'FAL_KEY',
} as const

export type LlmProvider = 'anthropic'

interface LlmVendor {
  base: string
  envVar: string
  allowedPaths: readonly string[]
  authHeaders: (key: string) => Record<string, string>
}

const LLM_VENDORS: Record<LlmProvider, LlmVendor> = {
  anthropic: {
    base: 'https://api.anthropic.com',
    envVar: ENV_VARS.anthropic,
    allowedPaths: ['v1/models', 'v1/messages'],
    authHeaders: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  },
}

export function agentConfig(env: ProxyEnv): { anthropic: boolean; fal: boolean } {
  return {
    anthropic: Boolean(env[ENV_VARS.anthropic]?.trim()),
    fal: Boolean(env[ENV_VARS.fal]?.trim()),
  }
}

export type UpstreamPlan =
  | { ok: true; url: string; headers: Record<string, string> }
  | { ok: false; status: number; message: string }

/** Target for /api/<provider>/<subPath>. `search` is the raw query ('' or '?…'). */
export function llmUpstream(
  provider: LlmProvider,
  subPath: string,
  search: string,
  env: ProxyEnv,
): UpstreamPlan {
  const vendor = LLM_VENDORS[provider]
  const key = env[vendor.envVar]?.trim()
  if (!key) {
    return { ok: false, status: 503, message: `No site key configured for ${provider}.` }
  }
  if (!vendor.allowedPaths.includes(subPath)) {
    return { ok: false, status: 404, message: `Path not allowed: ${subPath}` }
  }
  return { ok: true, url: `${vendor.base}/${subPath}${search}`, headers: vendor.authHeaders(key) }
}

/** Target for the Fal proxy protocol (`x-fal-target-url` header from @fal-ai/client). */
export function falUpstream(targetUrl: string | null, env: ProxyEnv): UpstreamPlan {
  const key = env[ENV_VARS.fal]?.trim()
  if (!key) return { ok: false, status: 503, message: 'No site key configured for fal.' }
  if (!targetUrl) return { ok: false, status: 400, message: 'Missing x-fal-target-url header.' }
  let url: URL
  try {
    url = new URL(targetUrl)
  } catch {
    return { ok: false, status: 412, message: 'Invalid x-fal-target-url header.' }
  }
  const host = url.hostname
  const allowed =
    url.protocol === 'https:' &&
    (host === 'fal.ai' || host.endsWith('.fal.ai') || host === 'fal.run' || host.endsWith('.fal.run'))
  if (!allowed) {
    return { ok: false, status: 412, message: `Target not allowed: ${host}` }
  }
  return { ok: true, url: url.toString(), headers: { authorization: `Key ${key}` } }
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function forward(request: Request, plan: UpstreamPlan): Promise<Response> {
  if (!plan.ok) return errorResponse(plan.status, plan.message)
  const headers: Record<string, string> = { ...plan.headers }
  const contentType = request.headers.get('content-type')
  if (contentType) headers['content-type'] = contentType
  // buffer the body: avoids fetch duplex requirements and works in both runtimes
  const body =
    request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()
  const upstream = await fetch(plan.url, { method: request.method, headers, body })
  const responseHeaders = new Headers()
  const upstreamType = upstream.headers.get('content-type')
  if (upstreamType) responseHeaders.set('content-type', upstreamType)
  responseHeaders.set('cache-control', 'no-store')
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}

const LLM_METHODS = ['GET', 'POST']
const FAL_METHODS = ['GET', 'POST', 'PUT', 'DELETE']

/** Route an /api/* request. Returns null when the path is not an agent route. */
export async function handleAgentApi(request: Request, env: ProxyEnv): Promise<Response | null> {
  const url = new URL(request.url)
  const path = url.pathname

  if (path === '/api/agent-config') {
    if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.')
    return new Response(JSON.stringify(agentConfig(env)), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  }

  for (const provider of ['anthropic'] as const) {
    const prefix = `/api/${provider}/`
    if (!path.startsWith(prefix)) continue
    if (!LLM_METHODS.includes(request.method)) return errorResponse(405, 'Method not allowed.')
    const subPath = path.slice(prefix.length)
    return forward(request, llmUpstream(provider, subPath, url.search, env))
  }

  if (path === '/api/fal/proxy') {
    if (!FAL_METHODS.includes(request.method)) return errorResponse(405, 'Method not allowed.')
    return forward(request, falUpstream(request.headers.get('x-fal-target-url'), env))
  }

  return null
}
