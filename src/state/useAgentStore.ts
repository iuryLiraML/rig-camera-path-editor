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
  taskProgress: string | null
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
  kimi: PROVIDERS.kimi.defaultModel,
}

const emptyKeys: Record<ProviderKind, string> = { anthropic: '', kimi: '' }

/** Providers were reduced to Anthropic + Kimi; anything else falls back. */
function normaliseProvider(value: unknown): ProviderKind {
  return value === 'anthropic' || value === 'kimi' ? value : 'anthropic'
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({
      provider: 'anthropic',
      keys: { ...emptyKeys },
      models: { ...defaultModels },
      visionMode: 'auto',
      guidelines: '',
      chat: [],
      status: 'idle',
      taskProgress: null,
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
          taskProgress: 'Starting task…',
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
          const turnsPerBatch = 32
          const maxBatches = 3
          let history = apiHistory
          let exhausted = true

          for (let batch = 0; batch < maxBatches; batch++) {
            const result = await runAgent({
              provider: config,
              system: buildSystemPrompt(guidelines, skills),
              messages: history,
              tools: TOOL_DEFS,
              execute: executeTool,
              signal: abortController.signal,
              maxTurns: turnsPerBatch,
              events: {
                onText: (delta) => patchAssistant((e) => ({ text: e.text + delta })),
                onToolResult: (name) => patchAssistant((e) => ({ tools: [...e.tools, name] })),
                onTurn: (turn) =>
                  set({ taskProgress: `Working… step ${batch * turnsPerBatch + turn}` }),
                onCheckpoint: (messages) => {
                  apiHistory = messages
                },
              },
            })
            history = result.messages
            apiHistory = history
            if (result.outcome === 'completed') {
              exhausted = false
              break
            }
            if (result.outcome === 'interrupted') {
              history = [
                ...history,
                {
                  role: 'user',
                  text:
                    'Continue the unfinished task from where you stopped. Do not repeat completed tool work; inspect camera_options and finish every remaining requested item.',
                },
              ]
              apiHistory = history
            }
          }

          apiHistory = history
          set({
            status: 'idle',
            taskProgress: null,
            error: exhausted
              ? 'The assistant reached the 96-step safety limit. Your completed work was preserved; send “Continue” to resume.'
              : null,
          })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          const aborted = message.includes('abort') || (e as Error)?.name === 'AbortError'
          // drop the dangling user turn so the history stays valid for the next send
          if (apiHistory[apiHistory.length - 1]?.role === 'user') apiHistory.pop()
          patchAssistant(() => ({ text: aborted ? '(stopped)' : '' }))
          set({
            status: 'idle',
            taskProgress: null,
            error: aborted ? null : friendlyError(message, vision),
          })
        } finally {
          abortController = null
        }
      },

      stop: () => abortController?.abort(),

      clearChat: () => {
        apiHistory = []
        set({ chat: [], taskProgress: null, error: null })
      },
    }),
    {
      name: 'rig-agent-settings',
      version: 4,
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
          return {
            provider: 'anthropic' as ProviderKind,
            keys: { ...emptyKeys, anthropic: (p.anthropicKey as string) ?? '' },
            models: { ...defaultModels, anthropic: (p.model as string) ?? defaultModels.anthropic },
            visionMode: 'auto' as VisionMode,
            guidelines: (p.guidelines as string) ?? '',
          }
        }
        if ('vision' in p && !('visionMode' in p)) {
          p.visionMode = p.vision === false ? 'off' : 'auto'
          delete p.vision
        }
        // v4 dropped OpenRouter and z.ai: keep only the keys/models that still
        // map to a supported provider, so stale ones cannot be selected.
        const persistedKeys = (p.keys ?? {}) as Record<string, string>
        const persistedModels = (p.models ?? {}) as Record<string, string>
        return {
          provider: normaliseProvider(p.provider),
          keys: {
            anthropic: persistedKeys.anthropic ?? '',
            kimi: persistedKeys.kimi ?? '',
          },
          models: {
            anthropic: persistedModels.anthropic || defaultModels.anthropic,
            kimi: persistedModels.kimi || defaultModels.kimi,
          },
          visionMode: (p.visionMode as VisionMode) ?? 'auto',
          guidelines: (p.guidelines as string) ?? '',
        }
      },
    },
  ),
)
