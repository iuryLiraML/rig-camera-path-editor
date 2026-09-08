import { afterEach, expect, it, vi } from 'vitest'
import { deleteCloudProject } from './client'

afterEach(() => { vi.unstubAllGlobals() })

it('sends an authenticated DELETE to the existing project endpoint', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  await deleteCloudProject('fixture-token', 'fixture-id')
  expect(fetch.mock.calls[0]).toEqual([
    expect.stringContaining('/v1/projects/fixture-id'),
    expect.objectContaining({ method: 'DELETE' }),
  ])
  const init = vi.mocked(globalThis.fetch).mock.calls[0][1]!
  expect(new Headers(init.headers).get('authorization')).toBe('Bearer fixture-token')
})

it('accepts an already removed record but rejects a missing backend route', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json({ error: 'project_not_found' }, { status: 404 }))
    .mockResolvedValueOnce(new Response('Route not found', { status: 404 })))
  await expect(deleteCloudProject('fixture-token', 'fixture-id')).resolves.toBeUndefined()
  await expect(deleteCloudProject('fixture-token', 'fixture-id')).rejects.toThrow('Request failed (404)')
})
