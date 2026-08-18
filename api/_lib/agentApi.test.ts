import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentConfig, falUpstream, handleAgentApi, llmUpstream } from './agentApi'

const ENV = {
  ANTHROPIC_API_KEY: 'sk-ant-site',
  KIMI_API_KEY: 'moonshot-site',
  FAL_KEY: 'fal-site',
}

describe('agentConfig', () => {
  it('reports which vendors have a site key, never the keys themselves', () => {
    expect(agentConfig(ENV)).toEqual({ anthropic: true, kimi: true, fal: true })
    expect(agentConfig({})).toEqual({ anthropic: false, kimi: false, fal: false })
    expect(agentConfig({ FAL_KEY: '  ' })).toEqual({ anthropic: false, kimi: false, fal: false })
  })
})

describe('llmUpstream', () => {
  it('maps the anthropic route and injects the site key header', () => {
    const plan = llmUpstream('anthropic', 'v1/messages', '', ENV)
    expect(plan).toEqual({
      ok: true,
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': 'sk-ant-site', 'anthropic-version': '2023-06-01' },
    })
  })

  it('keeps the query string and uses Bearer auth for kimi', () => {
    const plan = llmUpstream('kimi', 'v1/models', '?limit=5', ENV)
    expect(plan).toEqual({
      ok: true,
      url: 'https://api.moonshot.ai/v1/models?limit=5',
      headers: { authorization: 'Bearer moonshot-site' },
    })
  })

  it('rejects endpoints outside the allowlist so a shared key stays scoped', () => {
    const plan = llmUpstream('anthropic', 'v1/organizations/me', '', ENV)
    expect(plan).toMatchObject({ ok: false, status: 404 })
  })

  it('returns 503 when the deployment has no key for the vendor', () => {
    expect(llmUpstream('anthropic', 'v1/messages', '', {})).toMatchObject({ ok: false, status: 503 })
  })
})

describe('falUpstream', () => {
  it('allows fal.run and fal.ai hosts over https', () => {
    for (const target of [
      'https://queue.fal.run/fal-ai/sam-3/image',
      'https://rest.alpha.fal.ai/storage/upload/initiate',
      'https://fal.run/x',
    ]) {
      expect(falUpstream(target, ENV)).toMatchObject({
        ok: true,
        headers: { authorization: 'Key fal-site' },
      })
    }
  })

  it('rejects other hosts, lookalikes and plain http', () => {
    for (const target of [
      'https://evil.example.com/steal',
      'https://notfal.run/x',
      'https://fal.run.evil.com/x',
      'http://queue.fal.run/x',
    ]) {
      expect(falUpstream(target, ENV)).toMatchObject({ ok: false, status: 412 })
    }
  })

  it('fails clearly on a missing header or missing site key', () => {
    expect(falUpstream(null, ENV)).toMatchObject({ ok: false, status: 400 })
    expect(falUpstream('https://fal.run/x', {})).toMatchObject({ ok: false, status: 503 })
  })
})

describe('handleAgentApi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('serves /api/agent-config as booleans with no-store', async () => {
    const res = await handleAgentApi(new Request('http://localhost/api/agent-config'), ENV)
    expect(res?.status).toBe(200)
    expect(res?.headers.get('cache-control')).toBe('no-store')
    expect(await res?.json()).toEqual({ anthropic: true, kimi: true, fal: true })
  })

  it('forwards an anthropic call with the injected key and streams the body back', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('data: {}\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await handleAgentApi(
      new Request('http://localhost/api/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"model":"claude"}',
      }),
      ENV,
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-site')
    expect(res?.status).toBe(200)
    expect(res?.headers.get('content-type')).toBe('text/event-stream')
    expect(await res?.text()).toBe('data: {}\n\n')
  })

  it('routes the fal proxy by the x-fal-target-url header', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await handleAgentApi(
      new Request('http://localhost/api/fal/proxy', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-fal-target-url': 'https://queue.fal.run/fal-ai/sam-3/image',
        },
        body: '{}',
      }),
      ENV,
    )

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://queue.fal.run/fal-ai/sam-3/image')
    expect((init.headers as Record<string, string>).authorization).toBe('Key fal-site')
    expect(res?.status).toBe(200)
  })

  it('ignores non-agent routes so the cloud API proxy still gets them', async () => {
    const res = await handleAgentApi(new Request('http://localhost/api/v1/projects'), ENV)
    expect(res).toBeNull()
  })

  it('refuses non-GET on agent-config and bad methods on proxies', async () => {
    const config = await handleAgentApi(
      new Request('http://localhost/api/agent-config', { method: 'POST', body: '{}' }),
      ENV,
    )
    expect(config?.status).toBe(405)
    const del = await handleAgentApi(
      new Request('http://localhost/api/anthropic/v1/messages', { method: 'DELETE' }),
      ENV,
    )
    expect(del?.status).toBe(405)
  })
})
