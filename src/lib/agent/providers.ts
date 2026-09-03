/**
 * Agent runtime. A provider-neutral conversation is kept by the store and
 * converted here into the Anthropic Messages API wire format.
 *
 * One auth mode: every request goes through the same-origin /api proxy, which
 * attaches the deployment's shared site key server-side (see
 * api/_lib/agentApi.ts). There is deliberately no browser-side key — nothing
 * in the UI can set one, so a vendor credential never reaches the client.
 */

import { serverHasKey } from './serverKeys'

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
  | {
      role: 'user'
      text: string
      /** base64 still, no data: prefix — chat photo or viewport screenshot */
      image?: string
      /** extra stills (vision judge sends t=0, 0.5, 1). Falls back to `image`. */
      images?: string[]
      imageMediaType?: string
    }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export type ProviderKind = 'anthropic'

export interface ProviderConfig {
  kind: ProviderKind
  model: string
  /** send image parts (chat photo, or viewport screenshot when no photo) */
  vision: boolean
}

export interface ModelOption {
  id: string
  label: string
}

export const PROVIDERS: Record<ProviderKind, { label: string; defaultModel: string }> = {
  anthropic: { label: 'Anthropic', defaultModel: 'claude-opus-4-6' },
}

/**
 * URL for one vendor call. Always the same-origin proxy, which attaches the
 * site key itself, so no credential is ever held in the browser. Exported for
 * tests.
 */
export function providerRequest(kind: ProviderKind, path: string): { url: string } {
  return { url: `/api/${kind}/${path}` }
}

/** Can this provider be reached at all — i.e. does the deployment hold a site key? */
export function providerUsable(kind: ProviderKind): boolean {
  return serverHasKey(kind)
}

/** The models the deployment's key is entitled to use. Empty without a site key. */
export async function listProviderModels(kind: ProviderKind, signal?: AbortSignal): Promise<ModelOption[]> {
  if (!providerUsable(kind)) return []

  const req = providerRequest(kind, 'v1/models?limit=100')
  const res = await fetch(req.url, { signal })
  if (!res.ok) throw new Error(`Unable to load Anthropic models (${res.status})`)
  const body = (await res.json()) as { data?: { id?: string; display_name?: string }[] }
  return (body.data ?? [])
    .filter((model): model is { id: string; display_name?: string } => Boolean(model.id))
    .map((model) => ({ id: model.id, label: model.display_name || model.id }))
}

// Vision-capable model id patterns per provider. Kept conservative: 'Auto' only
// sends the screenshot when the id clearly advertises vision, because a
// text-only model rejects image parts with a 400.
const VISION_PATTERNS: Record<ProviderKind, RegExp> = {
  anthropic: /claude/i,
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

export function userStills(m: { image?: string; images?: string[] }): string[] {
  if (m.images && m.images.length > 0) return m.images.filter(Boolean)
  return m.image ? [m.image] : []
}

/** Coalesce consecutive tool results into a single user turn (Anthropic rule). */
function toAnthropicMessages(messages: AgentMessage[], vision: boolean) {
  const out: { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const content: AnthropicBlock[] = []
      if (vision) {
        for (const data of userStills(m)) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: m.imageMediaType ?? 'image/jpeg',
              data,
            },
          })
        }
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
  const req = providerRequest('anthropic', 'v1/messages')
  const res = await fetch(req.url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
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
  execute: (name: string, input: unknown) => string | Promise<string>
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

  for (let i = 0; i < maxTurns; i++) {
    opts.events?.onTurn?.(i + 1, maxTurns)
    const { text, toolCalls, stopReason } = await anthropicTurn(
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
        result = await opts.execute(tc.name, tc.input)
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
