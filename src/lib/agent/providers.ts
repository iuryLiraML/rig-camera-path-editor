/**
 * Multi-provider agent runtime. A provider-neutral conversation is kept by the
 * store; each client converts it to its own wire format. Anthropic uses the
 * Messages API; OpenRouter and z.ai use the OpenAI Chat Completions API.
 * All run BYOK, directly from the browser.
 */

export interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

export type AgentMessage =
  | { role: 'user'; text: string; image?: string } // image = base64 JPEG (no data: prefix)
  | { role: 'assistant'; text: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export type ProviderKind = 'anthropic' | 'kimi'

export interface ProviderConfig {
  kind: ProviderKind
  apiKey: string
  model: string
  /** send the viewport screenshot with each user turn */
  vision: boolean
}

export interface ModelOption {
  id: string
  label: string
}

export const PROVIDERS: Record<ProviderKind, { label: string; defaultModel: string; keyHint: string }> = {
  anthropic: { label: 'Anthropic', defaultModel: 'claude-sonnet-5', keyHint: 'sk-ant-…' },
  kimi: { label: 'Kimi', defaultModel: 'kimi-k3', keyHint: 'Moonshot API key' },
}

/** Return models usable with the selected provider and account. */
export async function listProviderModels(
  kind: ProviderKind,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ModelOption[]> {
  if (!apiKey.trim()) return []

  if (kind === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
    if (!res.ok) throw new Error(`Unable to load Anthropic models (${res.status})`)
    const body = (await res.json()) as { data?: { id?: string; display_name?: string }[] }
    return (body.data ?? [])
      .filter((model): model is { id: string; display_name?: string } => Boolean(model.id))
      .map((model) => ({ id: model.id, label: model.display_name || model.id }))
  }

  // Kimi (Moonshot) is OpenAI-compatible, so /v1/models returns the live list
  const res = await fetch('https://api.moonshot.ai/v1/models', {
    signal,
    headers: { authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`Unable to load Kimi models (${res.status})`)
  const body = (await res.json()) as { data?: { id?: string }[] }
  return (body.data ?? [])
    .filter((model): model is { id: string } => Boolean(model.id))
    .map((model) => ({ id: model.id, label: model.id }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

// Vision-capable model id patterns per provider. Kept conservative: 'Auto' only
// sends the screenshot when the id clearly advertises vision, because a
// text-only model rejects image parts with a 400.
const VISION_PATTERNS: Record<ProviderKind, RegExp> = {
  anthropic: /claude/i,
  kimi: /vision|-vl\b|latest/i,
}

/** Heuristic: does this model accept image input? Used by the Auto screenshot mode. */
export function modelSupportsVision(kind: ProviderKind, model: string): boolean {
  return VISION_PATTERNS[kind].test(model)
}

interface TurnResult {
  text: string
  toolCalls: ToolCall[]
  stopReason: string
}

export interface AgentEvents {
  onText?: (delta: string) => void
  onToolResult?: (name: string, result: string) => void
  onTurn?: (turn: number, maxTurns: number) => void
  onCheckpoint?: (messages: AgentMessage[]) => void
}

// ---------------------------------------------------------------------------
// Anthropic Messages API
// ---------------------------------------------------------------------------

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

/** Coalesce consecutive tool results into a single user turn (Anthropic rule). */
function toAnthropicMessages(messages: AgentMessage[], vision: boolean) {
  const out: { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const content: AnthropicBlock[] = []
      if (m.image && vision) {
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: m.image } })
      }
      content.push({ type: 'text', text: m.text })
      out.push({ role: 'user', content })
    } else if (m.role === 'assistant') {
      const content: AnthropicBlock[] = []
      if (m.text) content.push({ type: 'text', text: m.text })
      for (const tc of m.toolCalls) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
      out.push({ role: 'assistant', content })
    } else {
      const block: AnthropicBlock = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }
      const last = out[out.length - 1]
      if (last && last.role === 'user' && last.content.every((b) => b.type === 'tool_result')) {
        last.content.push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
    }
  }
  return out
}

async function anthropicTurn(
  cfg: ProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: ToolDef[],
  signal: AbortSignal | undefined,
  events: AgentEvents | undefined,
): Promise<TurnResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      system,
      messages: toAnthropicMessages(messages, cfg.vision),
      tools,
      stream: true,
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)

  let text = ''
  const toolCalls: ToolCall[] = []
  let stopReason = 'end_turn'
  const blocks: { type: string; id?: string; name?: string; json?: string }[] = []

  await readSSE(res, (payload) => {
    const evt = JSON.parse(payload)
    switch (evt.type) {
      case 'content_block_start':
        blocks[evt.index] =
          evt.content_block.type === 'tool_use'
            ? { type: 'tool_use', id: evt.content_block.id, name: evt.content_block.name, json: '' }
            : { type: 'text' }
        break
      case 'content_block_delta':
        if (evt.delta?.type === 'text_delta') {
          text += evt.delta.text
          events?.onText?.(evt.delta.text)
        } else if (evt.delta?.type === 'input_json_delta') {
          const b = blocks[evt.index]
          if (b) b.json = (b.json ?? '') + evt.delta.partial_json
        }
        break
      case 'content_block_stop': {
        const b = blocks[evt.index]
        if (b?.type === 'tool_use') {
          let input: unknown = {}
          try {
            input = b.json ? JSON.parse(b.json) : {}
          } catch {
            input = {}
          }
          toolCalls.push({ id: b.id!, name: b.name!, input })
        }
        break
      }
      case 'message_delta':
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason
        break
      case 'error':
        throw new Error(evt.error?.message ?? 'Anthropic stream error')
    }
  })

  return { text, toolCalls, stopReason }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible Chat Completions (OpenRouter, z.ai)
// ---------------------------------------------------------------------------

const OPENAI_ENDPOINTS: Record<Exclude<ProviderKind, 'anthropic'>, string> = {
  kimi: 'https://api.moonshot.ai/v1/chat/completions',
}

function toOpenAIMessages(system: string, messages: AgentMessage[], vision: boolean) {
  const out: unknown[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.image && vision) {
        out.push({
          role: 'user',
          content: [
            { type: 'text', text: m.text },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${m.image}` } },
          ],
        })
      } else {
        out.push({ role: 'user', content: m.text })
      }
    } else if (m.role === 'assistant') {
      const msg: Record<string, unknown> = { role: 'assistant', content: m.text || null }
      if (m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
        }))
      }
      out.push(msg)
    } else {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
    }
  }
  return out
}

async function openaiTurn(
  cfg: ProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: ToolDef[],
  signal: AbortSignal | undefined,
  events: AgentEvents | undefined,
): Promise<TurnResult> {
  const endpoint = OPENAI_ENDPOINTS[cfg.kind as Exclude<ProviderKind, 'anthropic'>]
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${cfg.apiKey}`,
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages: toOpenAIMessages(system, messages, cfg.vision),
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      })),
      tool_choice: 'auto',
      stream: true,
    }),
  })
  if (!res.ok) throw new Error(`${PROVIDERS[cfg.kind].label} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)

  let text = ''
  let stopReason = 'stop'
  // tool calls stream in fragments keyed by index
  const acc: { id: string; name: string; args: string }[] = []

  await readSSE(res, (payload) => {
    if (payload === '[DONE]') return
    const evt = JSON.parse(payload)
    const choice = evt.choices?.[0]
    if (!choice) return
    const delta = choice.delta ?? {}
    if (typeof delta.content === 'string' && delta.content) {
      text += delta.content
      events?.onText?.(delta.content)
    }
    for (const tc of delta.tool_calls ?? []) {
      const i = tc.index ?? 0
      acc[i] ??= { id: '', name: '', args: '' }
      if (tc.id) acc[i].id = tc.id
      if (tc.function?.name) acc[i].name = tc.function.name
      if (tc.function?.arguments) acc[i].args += tc.function.arguments
    }
    if (choice.finish_reason) stopReason = choice.finish_reason
  })

  const toolCalls: ToolCall[] = acc.filter(Boolean).map((t, i) => {
    let input: unknown = {}
    try {
      input = t.args ? JSON.parse(t.args) : {}
    } catch {
      input = {}
    }
    return { id: t.id || `call_${i}`, name: t.name, input }
  })

  return { text, toolCalls, stopReason: stopReason === 'tool_calls' ? 'tool_use' : stopReason }
}

// ---------------------------------------------------------------------------
// Shared SSE reader — calls `onData` with each `data:` payload string
// ---------------------------------------------------------------------------

async function readSSE(res: Response, onData: (payload: string) => void) {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload) onData(payload)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tool-use loop over the neutral conversation
// ---------------------------------------------------------------------------

export async function runAgent(opts: {
  provider: ProviderConfig
  system: string
  messages: AgentMessage[]
  tools: ToolDef[]
  execute: (name: string, input: unknown) => string
  signal?: AbortSignal
  events?: AgentEvents
  maxTurns?: number
}): Promise<{
  messages: AgentMessage[]
  outcome: 'completed' | 'interrupted' | 'exhausted'
  turns: number
}> {
  const messages = [...opts.messages]
  const maxTurns = opts.maxTurns ?? 32
  const turn = opts.provider.kind === 'anthropic' ? anthropicTurn : openaiTurn

  for (let i = 0; i < maxTurns; i++) {
    opts.events?.onTurn?.(i + 1, maxTurns)
    const { text, toolCalls, stopReason } = await turn(
      opts.provider,
      opts.system,
      messages,
      opts.tools,
      opts.signal,
      opts.events,
    )
    if (stopReason !== 'tool_use' || toolCalls.length === 0) {
      // A token/provider interruption may leave a partial tool call. Do not
      // persist it without a matching tool result; the continuation will retry.
      messages.push({ role: 'assistant', text, toolCalls: [] })
      const completedNormally = stopReason === 'stop' || stopReason === 'end_turn'
      return {
        messages,
        outcome: completedNormally ? 'completed' : 'interrupted',
        turns: i + 1,
      }
    }
    messages.push({ role: 'assistant', text, toolCalls })

    for (const tc of toolCalls) {
      let result: string
      try {
        result = opts.execute(tc.name, tc.input)
      } catch (e) {
        result = `Error: ${e instanceof Error ? e.message : String(e)}`
      }
      opts.events?.onToolResult?.(tc.name, result)
      messages.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: result })
    }
    opts.events?.onCheckpoint?.([...messages])
  }

  return { messages, outcome: 'exhausted', turns: maxTurns }
}
