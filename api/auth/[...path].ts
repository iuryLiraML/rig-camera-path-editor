import { handleAuthApi } from '../_lib/authApi'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  return (await handleAuthApi(request, process.env)) ?? new Response('Not found', { status: 404 })
}
