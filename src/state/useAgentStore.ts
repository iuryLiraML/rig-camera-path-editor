import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  runAgent,
  modelSupportsVision,
  PROVIDERS,
  type AgentMessage,
  type ProviderConfig,
  type ProviderKind,
} from '../lib/agent/providers'

export type VisionMode = 'auto' | 'on' | 'off'
import { buildSceneContext, captureViewport, executeTool, TOOL_DEFS } from '../lib/agent/tools'
import { buildSystemPrompt } from '../lib/agent/systemPrompt'
import { useProjectStore } from './useProjectStore'

export interface ChatEntry {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** labels of tools the assistant executed while producing this entry */
  tools: string[]
}

interface AgentState {
  // settings (persisted)
  provider: ProviderKind
  /** API key per provider */
  keys: Record<ProviderKind, string>
  /** model id per provider */
  models: Record<ProviderKind, string>
  visionMode: VisionMode
  guidelines: string
  // conversation (session only — API history kept in module scope)
  chat: ChatEntry[]
  status: 'idle' | 'thinking'
  error: string | null
  forcedSkill: string | null

  setProvider: (kind: ProviderKind) => void
  setKey: (kind: ProviderKind, key: string) => void
  setModel: (kind: ProviderKind, model: string) => void
  setVisionMode: (mode: VisionMode) => void
  setGuidelines: (text: string) => void
  setForcedSkill: (name: string | null) => void
  /** active provider has a usable key */
  hasKey: () => boolean
  /** whether the screenshot is actually sent for the active provider/model */
  visionActive: () => boolean
  sendMessage: (text: string) => Promise<void>
  stop: () => void
  clearChat: () => void
}

let entryId = 1
const makeEntryId = () => `chat-${entryId++}`

/** Turn raw API errors into an actionable hint. */
function friendlyError(message: string, visionSent: boolean): string {
  if (/\b(401|403|invalid api key|unauthorized|authentication)\b/i.test(message)) {
    return `${message}\n\nCheck your API key in Settings.`
  }
  if (/\b(429|insufficient balance|no resource package|quota|rate limit|please recharge)\b/i.test(message)) {
    return `${message}\n\nThis is a billing/quota issue on the provider side — your account is out of credits or hit its rate limit. Recharge at the provider's dashboard, switch provider in Settings, or wait and retry.`
  }
  if (visionSent && /image|vision|multimodal|not support|unsupported|modality/i.test(message)) {
    return `${message}\n\nThis model may not accept the viewport screenshot — set Screenshot to Off (or Auto) in Settings.`
  }
  return message
}

/** Provider-neutral conversation history (holds images/tool calls — not persisted). */
let apiHistory: AgentMessage[] = []
let abortController: AbortController | null = null

const defaultModels: Record<ProviderKind, string> = {
  anthropic: PROVIDERS.anthropic.defaultModel,
  openrouter: PROVIDERS.openrouter.defaultModel,
  zai: PROVIDERS.zai.defaultModel,
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({
      provider: 'anthropic',
      keys: { anthropic: '', openrouter: '', zai: '' },
      models: { ...defaultModels },
      visionMode: 'auto',
      guidelines: '',
      chat: [],
      status: 'idle',
      error: null,
      forcedSkill: null,

      setProvider: (provider) => set({ provider }),
      setKey: (kind, key) => set((s) => ({ keys: { ...s.keys, [kind]: key } })),
      setModel: (kind, model) => set((s) => ({ models: { ...s.models, [kind]: model } })),
      setVisionMode: (visionMode) => set({ visionMode }),
      setGuidelines: (guidelines) => set({ guidelines }),
      setForcedSkill: (forcedSkill) => set({ forcedSkill }),

      hasKey: () => {
        const s = get()
        return (s.keys[s.provider] ?? '').trim().length > 0
      },

      visionActive: () => {
        const s = get()
        const model = (s.models[s.provider] ?? '').trim() || PROVIDERS[s.provider].defaultModel
        const capable = modelSupportsVision(s.provider, model)
        if (s.visionMode === 'off') return false
        // 'on' is downgraded silently on text-only models so the request
        // doesn't 400 with `messages.content.type is invalid`.
        return capable
      },

      sendMessage: async (text) => {
        const { provider, keys, models, forcedSkill, status } = get()
        const { guidelines, skills } = useProjectStore.getState()
        if (status === 'thinking' || !text.trim()) return
        const apiKey = (keys[provider] ?? '').trim()
        if (!apiKey) {
          set({ error: `Add your ${PROVIDERS[provider].label} API key in Settings first.` })
          return
        }
        const vision = get().visionActive()
        const config: ProviderConfig = {
          kind: provider,
          apiKey,
          model: (models[provider] ?? '').trim() || PROVIDERS[provider].defaultModel,
          vision,
        }

        const userText = forcedSkill ? `${text}\n\n(Use the "${forcedSkill}" skill for this request.)` : text
        set((s) => ({
          chat: [...s.chat, { id: makeEntryId(), role: 'user', text, tools: [] }],
          status: 'thinking',
          error: null,
          forcedSkill: null,
        }))

        // fresh scene context + screenshot on every user turn
        apiHistory.push({
          role: 'user',
          text: `<scene_state>\n${buildSceneContext()}\n</scene_state>\n\n${userText}`,
          image: vision ? (captureViewport() ?? undefined) : undefined,
        })

        // live assistant entry that streams in place
        const assistantId = makeEntryId()
        set((s) => ({ chat: [...s.chat, { id: assistantId, role: 'assistant', text: '', tools: [] }] }))
        const patchAssistant = (fn: (e: ChatEntry) => Partial<ChatEntry>) =>
          set((s) => ({
            chat: s.chat.map((e) => (e.id === assistantId ? { ...e, ...fn(e) } : e)),
          }))

        abortController = new AbortController()
        try {
          apiHistory = await runAgent({
            provider: config,
            system: buildSystemPrompt(guidelines, skills),
            messages: apiHistory,
            tools: TOOL_DEFS,
            execute: executeTool,
            signal: abortController.signal,
            events: {
              onText: (delta) => patchAssistant((e) => ({ text: e.text + delta })),
              onToolResult: (name) => patchAssistant((e) => ({ tools: [...e.tools, name] })),
            },
          })
          set({ status: 'idle' })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          const aborted = message.includes('abort') || (e as Error)?.name === 'AbortError'
          // drop the dangling user turn so the history stays valid for the next send
          if (apiHistory[apiHistory.length - 1]?.role === 'user') apiHistory.pop()
          patchAssistant(() => ({ text: aborted ? '(stopped)' : '' }))
          set({ status: 'idle', error: aborted ? null : friendlyError(message, vision) })
        } finally {
          abortController = null
        }
      },

      stop: () => abortController?.abort(),

      clearChat: () => {
        apiHistory = []
        set({ chat: [], error: null })
      },
    }),
    {
      name: 'rig-agent-settings',
      version: 3,
      partialize: (s) => ({
        provider: s.provider,
        keys: s.keys,
        models: s.models,
        visionMode: s.visionMode,
        guidelines: s.guidelines,
      }),
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Record<string, unknown>
        if (version < 2) {
          // v1 stored a single anthropicKey + model
          return {
            provider: 'anthropic',
            keys: { anthropic: (p.anthropicKey as string) ?? '', openrouter: '', zai: '' },
            models: { ...defaultModels, anthropic: (p.model as string) ?? defaultModels.anthropic },
            visionMode: 'auto',
            guidelines: (p.guidelines as string) ?? '',
          }
        }
        // v2 used a boolean `vision`; fold it into the new visionMode
        if ('vision' in p && !('visionMode' in p)) {
          p.visionMode = p.vision === false ? 'off' : 'auto'
          delete p.vision
        }
        return p
      },
    },
  ),
)
