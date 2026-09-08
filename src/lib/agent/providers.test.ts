import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAgent, userStills, type ToolDef } from './providers'

const stepTool: ToolDef = {
  name: 'create_step',
  description: 'Create one step in a long task.',
  input_schema: {
    type: 'object',
    properties: { index: { type: 'number' } },
    required: ['index'],
  },
}

/**
 * One Anthropic SSE response. No `[DONE]` sentinel — that is an OpenAI
 * convention, and anthropicTurn JSON.parses every `data:` line it sees.
 */
function streamResponse(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

/** A turn whose only content block is a tool_use, ending with stop_reason tool_use. */
function toolUseTurn(id: string, name: string, argsJson: string, stopReason = 'tool_use') {
  return [
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: argsJson } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason } },
  ]
}

/** A plain text turn. `stopReason` is 'end_turn' for a normal completion. */
function textTurn(text: string, stopReason = 'end_turn') {
  return [
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason } },
  ]
}

const PROVIDER = { kind: 'anthropic', model: 'claude-test', vision: false } as const

describe('runAgent', () => {
  afterEach(() => vi.restoreAllMocks())

  it('continues a ten-step tool task until the model reports completion', async () => {
    let request = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        request++
        return request <= 10
          ? streamResponse(toolUseTurn(`call-${request}`, 'create_step', JSON.stringify({ index: request })))
          : streamResponse(textTurn('All ten steps are complete.'))
      }),
    )

    const completed: number[] = []
    const result = await runAgent({
      provider: PROVIDER,
      system: 'Complete every requested step.',
      messages: [{ role: 'user', text: 'Create ten steps.' }],
      tools: [stepTool],
      execute: (_name, input) => {
        completed.push((input as { index: number }).index)
        return 'ok'
      },
    })

    expect(completed).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(result.outcome).toBe('completed')
    expect(result.messages.at(-1)).toMatchObject({
      role: 'assistant',
      text: 'All ten steps are complete.',
    })
  })

  it('sends every request to the same-origin proxy with no credential', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      streamResponse(textTurn('Done.')),
    )
    vi.stubGlobal('fetch', fetchMock)

    await runAgent({
      provider: PROVIDER,
      system: 'Do it.',
      messages: [{ role: 'user', text: 'Go.' }],
      tools: [stepTool],
      execute: () => 'ok',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/anthropic/v1/messages')
    // no x-api-key, no authorization: the proxy attaches the site key server-side
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('reports when the safety turn budget is exhausted', async () => {
    let request = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        request++
        return streamResponse(
          toolUseTurn(`call-${request}`, 'create_step', JSON.stringify({ index: request })),
        )
      }),
    )

    const completed: number[] = []
    const result = await runAgent({
      provider: PROVIDER,
      system: 'Keep working.',
      messages: [{ role: 'user', text: 'Create many steps.' }],
      tools: [stepTool],
      execute: (_name, input) => {
        completed.push((input as { index: number }).index)
        return 'ok'
      },
      maxTurns: 3,
    })

    expect(completed).toEqual([1, 2, 3])
    expect(result).toMatchObject({ outcome: 'exhausted', turns: 3 })
  })

  it('reports a token-limited response as interrupted instead of completed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(textTurn('Partial response', 'max_tokens'))))

    const result = await runAgent({
      provider: PROVIDER,
      system: 'Complete the task.',
      messages: [{ role: 'user', text: 'Do the task.' }],
      tools: [stepTool],
      execute: () => 'ok',
    })

    expect(result.outcome).toBe('interrupted')
  })

  it('discards incomplete tool calls from token-limited history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse([
          { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'I started the next step.' },
          },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'incomplete-call', name: 'create_step' },
          },
          // truncated arguments — the model was cut off mid-JSON
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: '{"index":' },
          },
          { type: 'content_block_stop', index: 1 },
          { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
        ]),
      ),
    )

    const result = await runAgent({
      provider: PROVIDER,
      system: 'Complete the task.',
      messages: [{ role: 'user', text: 'Do the task.' }],
      tools: [stepTool],
      execute: () => 'must not execute',
    })

    expect(result.messages.at(-1)).toMatchObject({ role: 'assistant', toolCalls: [] })
    expect(result.messages.some((message) => message.role === 'tool')).toBe(false)
  })

  it('checkpoints completed tools before a later provider failure', async () => {
    let request = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        request++
        if (request > 1) throw new Error('provider disconnected')
        return streamResponse(toolUseTurn('call-1', 'create_step', '{"index":1}'))
      }),
    )

    let checkpoint: unknown[] = []
    await expect(
      runAgent({
        provider: PROVIDER,
        system: 'Complete the task.',
        messages: [{ role: 'user', text: 'Do the task.' }],
        tools: [stepTool],
        execute: () => 'ok',
        events: { onCheckpoint: (messages) => (checkpoint = messages) },
      }),
    ).rejects.toThrow('provider disconnected')

    expect(checkpoint.at(-1)).toMatchObject({ role: 'tool', name: 'create_step', content: 'ok' })
  })

  it('awaits an async execute before sending the tool result', async () => {
    let request = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        request++
        return request === 1
          ? streamResponse(toolUseTurn('call-async', 'create_step', JSON.stringify({ index: 1 })))
          : streamResponse(textTurn('Lifted.'))
      }),
    )

    let saw = ''
    const result = await runAgent({
      provider: PROVIDER,
      system: 'Lift.',
      messages: [{ role: 'user', text: 'Lift the person.' }],
      tools: [stepTool],
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        saw = 'done'
        return 'placed obj-1'
      },
    })

    expect(saw).toBe('done')
    expect(result.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'tool', content: 'placed obj-1' })]),
    )
  })
})

describe('userStills', () => {
  it('prefers the images list over a single still', () => {
    expect(userStills({ image: 'mid', images: ['a', 'b', 'c'] })).toEqual(['a', 'b', 'c'])
    expect(userStills({ image: 'mid' })).toEqual(['mid'])
    expect(userStills({})).toEqual([])
  })
})
