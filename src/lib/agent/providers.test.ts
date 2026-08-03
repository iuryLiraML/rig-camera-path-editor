import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAgent, type ToolDef } from './providers'

const stepTool: ToolDef = {
  name: 'create_step',
  description: 'Create one step in a long task.',
  input_schema: {
    type: 'object',
    properties: { index: { type: 'number' } },
    required: ['index'],
  },
}

function streamResponse(event: unknown) {
  return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('runAgent', () => {
  afterEach(() => vi.restoreAllMocks())

  it('continues a ten-step tool task until the model reports completion', async () => {
    let request = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        request++
        if (request <= 10) {
          return streamResponse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `call-${request}`,
                      function: { name: 'create_step', arguments: JSON.stringify({ index: request }) },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          })
        }
        return streamResponse({
          choices: [{ delta: { content: 'All ten steps are complete.' }, finish_reason: 'stop' }],
        })
      }),
    )

    const completed: number[] = []
    const result = await runAgent({
      provider: { kind: 'kimi', apiKey: 'test-key', model: 'kimi-test', vision: false },
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

  it('reports when the safety turn budget is exhausted', async () => {
    let request = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        request++
        return streamResponse({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${request}`,
                    function: { name: 'create_step', arguments: JSON.stringify({ index: request }) },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        })
      }),
    )

    const completed: number[] = []
    const result = await runAgent({
      provider: { kind: 'kimi', apiKey: 'test-key', model: 'kimi-test', vision: false },
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse({
          choices: [{ delta: { content: 'Partial response' }, finish_reason: 'length' }],
        }),
      ),
    )

    const result = await runAgent({
      provider: { kind: 'kimi', apiKey: 'test-key', model: 'kimi-test', vision: false },
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
        streamResponse({
          choices: [
            {
              delta: {
                content: 'I started the next step.',
                tool_calls: [
                  {
                    index: 0,
                    id: 'incomplete-call',
                    function: { name: 'create_step', arguments: '{"index":' },
                  },
                ],
              },
              finish_reason: 'length',
            },
          ],
        }),
      ),
    )

    const result = await runAgent({
      provider: { kind: 'kimi', apiKey: 'test-key', model: 'kimi-test', vision: false },
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
        return streamResponse({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-1',
                    function: { name: 'create_step', arguments: '{"index":1}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        })
      }),
    )

    let checkpoint: unknown[] = []
    await expect(
      runAgent({
        provider: { kind: 'kimi', apiKey: 'test-key', model: 'kimi-test', vision: false },
        system: 'Complete the task.',
        messages: [{ role: 'user', text: 'Do the task.' }],
        tools: [stepTool],
        execute: () => 'ok',
        events: { onCheckpoint: (messages) => (checkpoint = messages) },
      }),
    ).rejects.toThrow('provider disconnected')

    expect(checkpoint.at(-1)).toMatchObject({ role: 'tool', name: 'create_step', content: 'ok' })
  })
})
