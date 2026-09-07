import { handleAgentApi } from '../_lib/agentApi'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  return (await handleAgentApi(request, process.env)) ?? new Response('Not found', { status: 404 })
}
