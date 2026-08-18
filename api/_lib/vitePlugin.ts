import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { handleAgentApi, type ProxyEnv } from './agentApi'

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value)
    else if (Array.isArray(value)) headers.set(name, value.join(', '))
  }
  const method = req.method ?? 'GET'
  let body: Buffer | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    body = Buffer.concat(chunks)
  }
  return new Request(`http://localhost${req.url ?? '/'}`, { method, headers, body })
}

async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, name) => res.setHeader(name, value))
  if (response.body) {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
  }
  res.end()
}

/**
 * Serves the same /api agent routes in `npm run dev` that Vercel serves in
 * production (api/ edge functions), reading keys from .env.local / process.env.
 * Registered via configureServer, so it runs before Vite's /api -> :8787 proxy
 * and only intercepts the agent routes — everything else still reaches the
 * cloud backend.
 */
export function agentApiDevPlugin(env: ProxyEnv): Plugin {
  return {
    name: 'rig-agent-api-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void (async () => {
          const request = await toWebRequest(req)
          const response = await handleAgentApi(request, env)
          if (!response) {
            next()
            return
          }
          await writeWebResponse(res, response)
        })().catch((error) => {
          res.statusCode = 500
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Proxy error' }))
        })
      })
    },
  }
}
