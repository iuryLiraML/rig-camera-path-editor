import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  modelSupportsVision,
  PROVIDERS,
  type AgentMessage,
  type ProviderConfig,
  type ProviderKind,
} from '../lib/agent/providers'
import { runShotCompiler } from '../lib/agent/shotCompiler'
import { buildSystemPrompt } from '../lib/agent/systemPrompt'
import { encodeStillForAgent, userTurnImage, visionForTurn } from '../lib/agent/stillImage'
import { buildSceneContext, captureViewport } from '../lib/agent/tools'
import { getLiftAttachment, isVideoFile, setLiftAttachment } from '../lib/fal/attachment'
import { NO_SERVER_KEYS, type ServerKeys } from '../lib/agent/serverKeys'
import { configureFal } from '../lib/fal/client'
import { setFalAbortSignal, syncFalSettings } from '../lib/fal/settings'
import type { SamImageVersion } from '../lib/fal/models'
import { useProjectStore } from './useProjectStore'
import { CLOUD_ACCESS_TOKEN_KEY } from '../lib/cloud/client'

export type VisionMode = 'auto' | 'on' | 'off'

export interface ChatEntry {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** labels of tools the assistant executed while producing this entry */
  tools: string[]
  attached?: string
}

interface AgentState {
  // settings (persisted)
  provider: ProviderKind
  /** model id per provider */
  models: Record<ProviderKind, string>
  visionMode: VisionMode
  guidelines: string
  /** Fal BYOK — not an LLM provider (D10). */
  falKey: string
  samImageVersion: SamImageVersion
  /** Deployment site keys available via the /api proxy (session only, from /api/agent-config). */
  serverKeys: ServerKeys
  // conversation (session only — API history kept in module scope)
  chat: ChatEntry[]
  status: 'idle' | 'thinking'
  taskProgress: string | null
  error: string | null
  forcedSkill: string | null
  failChips: string[]
  /** Filename of the still kept for SAM retries (session only). */
  liftPhotoName: string | null
  liftAttachmentKind: 'photo' | null

  setProvider: (kind: ProviderKind) => void
  setModel: (kind: ProviderKind, model: string) => void
  setVisionMode: (mode: VisionMode) => void
  setGuidelines: (text: string) => void
  setForcedSkill: (name: string | null) => void
  setFalKey: (key: string) => void
  setSamImageVersion: (version: SamImageVersion) => void
  setServerKeys: (keys: ServerKeys) => void
  /** the deployment holds a site key for the active provider */
  hasKey: () => boolean
  hasFalKey: () => boolean
  /** whether the screenshot is actually sent for the active provider/model */
  visionActive: () => boolean
  sendMessage: (text: string, image?: File) => Promise<void>
  stop: () => void
  clearChat: () => void
  hydrateDirectorChat: () => void
}

let entryId = 1
const makeEntryId = () => `chat-${entryId++}`

function persistDirectorChat() {
  const chat = useAgentStore.getState().chat
  useProjectStore.getState().setDirectorChat(chat)
}

/** Turn raw API errors into an actionable hint. */
function friendlyError(message: string, visionSent: boolean): string {
  if (/\b(401|403|invalid api key|unauthorized|authentication)\b/i.test(message)) {
    return `${message}\n\nThe deployment's ${PROVIDERS.anthropic.label} key was rejected — it needs to be checked in the Vercel environment variables.`
  }
  if (/\b(429|insufficient balance|no resource package|quota|rate limit|please recharge)\b/i.test(message)) {
    return `${message}\n\nThis is a billing/quota issue on the ${PROVIDERS.anthropic.label} account behind the deployment's shared key — it is out of credits or hit its rate limit. Wait and retry, or top the account up.`
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
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({
      provider: 'anthropic',
      models: { ...defaultModels },
      visionMode: 'auto',
      guidelines: '',
      falKey: '',
      samImageVersion: '3.1',
      serverKeys: NO_SERVER_KEYS,
      chat: [],
      status: 'idle',
      taskProgress: null,
      error: null,
      forcedSkill: null,
      failChips: [],
      liftPhotoName: null,
      liftAttachmentKind: null,

      setProvider: (provider) => set({ provider }),
      setModel: (kind, model) => set((s) => ({ models: { ...s.models, [kind]: model } })),
      setVisionMode: (visionMode) => set({ visionMode }),
      setGuidelines: (guidelines) => set({ guidelines }),
      setForcedSkill: (forcedSkill) => set({ forcedSkill }),
      setFalKey: (falKey) => {
        syncFalSettings(falKey, get().samImageVersion)
        configureFal(falKey)
        set({ falKey })
      },
      setSamImageVersion: (samImageVersion) => {
        syncFalSettings(get().falKey, samImageVersion)
        set({ samImageVersion })
      },
      setServerKeys: (serverKeys) => set({ serverKeys }),

      hasKey: () => get().serverKeys[get().provider],
      hasFalKey: () => {
        const s = get()
        return s.falKey.trim().length > 0 || s.serverKeys.fal
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

      sendMessage: async (text, image) => {
        const { provider, models, forcedSkill, status, falKey, samImageVersion } = get()
        const { guidelines, skills, directorLessons } = useProjectStore.getState()
        const trimmed = text.trim()
        if (image && isVideoFile(image)) {
          set({ error: 'Video is no longer supported. Attach a photo to lift a person.' })
          return
        }
        const userText = trimmed || (image ? 'Lift the subject from the attached photo.' : '')
        if (status === 'thinking' || !userText) return
        if (image) {
          setLiftAttachment(image)
          set({ liftPhotoName: image.name, liftAttachmentKind: 'photo' })
        }
        const media = image ?? getLiftAttachment()
        syncFalSettings(falKey, samImageVersion)
        // every call goes through the same-origin /api proxy, which holds the
        // key server-side — so with no site key there is nothing to fall back on
        if (!get().serverKeys[provider]) {
          set({
            error: `No ${PROVIDERS[provider].label} key is configured on this deployment, so the Director cannot run. Set ANTHROPIC_API_KEY in the Vercel project and redeploy.`,
          })
          return
        }
        const modelId = (models[provider] ?? '').trim() || PROVIDERS[provider].defaultModel
        const capable = modelSupportsVision(provider, modelId)
        const screenshot = get().visionActive()
        const vision = visionForTurn({
          screenshotActive: screenshot,
          hasChatPhoto: Boolean(media),
          modelSupportsVision: capable,
        })
        const config: ProviderConfig = {
          kind: provider,
          model: modelId,
          vision,
        }

        const directed = forcedSkill
          ? `${userText}\n\n(Use the "${forcedSkill}" skill for this request.)`
          : userText
        const withMedia = media
          ? `${directed}\n\n[Attached photo: ${media.name} is still in this chat. The image on this message is that still — not the 3D viewport. If the user wants people posed or retried from it, call block_people_from_image again (SAM 3.1 then 3D Body). Do not treat scene primitives as the photo.]`
          : directed
        set((s) => ({
          chat: [
            ...s.chat,
            {
              id: makeEntryId(),
              role: 'user',
              text: trimmed || userText,
              tools: [],
              attached: image?.name ?? (media && !image ? media.name : undefined),
            },
          ],
          status: 'thinking',
          taskProgress: 'Starting task…',
          error: null,
          forcedSkill: null,
          failChips: [],
        }))

        const chatPhoto = media && capable ? await encodeStillForAgent(media) : null
        const still = userTurnImage({
          chatPhoto,
          screenshot: media ? false : screenshot,
          viewport: media ? null : screenshot ? captureViewport() : null,
        })
        apiHistory.push({
          role: 'user',
          text: `<scene_state>\n${buildSceneContext()}\n</scene_state>\n\n${withMedia}`,
          image: still?.data,
          imageMediaType: still?.mediaType,
        })

        // live assistant entry that streams in place
        const assistantId = makeEntryId()
        set((s) => ({ chat: [...s.chat, { id: assistantId, role: 'assistant', text: '', tools: [] }] }))
        const patchAssistant = (fn: (e: ChatEntry) => Partial<ChatEntry>) =>
          set((s) => ({
            chat: s.chat.map((e) => (e.id === assistantId ? { ...e, ...fn(e) } : e)),
          }))

        abortController = new AbortController()
        setFalAbortSignal(abortController.signal)
        try {
          const result = await runShotCompiler({
            provider: config,
            system: buildSystemPrompt(guidelines, skills, directorLessons),
            messages: apiHistory,
            userText: withMedia,
            hasImage: Boolean(media),
            signal: abortController.signal,
            events: {
              onText: (delta) => patchAssistant((e) => ({ text: e.text + delta })),
              onToolResult: (name) => patchAssistant((e) => ({ tools: [...e.tools, name] })),
              onProgress: (label) => set({ taskProgress: label }),
              onCheckpoint: (messages) => {
                apiHistory = messages
              },
            },
          })
          apiHistory = result.messages
          if (result.askUser) {
            patchAssistant(() => ({ text: result.askUser ?? '' }))
          } else if (result.passed) {
            patchAssistant((e) => ({
              text:
                e.text.trim() ||
                'Shot is blocked. Scrub the timeline or ask for a tighter/slower take.',
            }))
            if (result.retried) {
              useProjectStore.getState().addDirectorLesson(
                `${result.plan?.move_kind ?? 'shot'} on this subject: keep fill in the ${result.plan?.shot_scale ?? 'auto'} band.`,
              )
            }
          } else {
            patchAssistant((e) => ({
              text:
                e.text.trim() ||
                'Could not lock framing. Try Closer, Slower, or pick the subject in the outliner.',
            }))
          }
          persistDirectorChat()
          set({
            status: 'idle',
            taskProgress: null,
            failChips: result.failChips,
            error: null,
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
          setFalAbortSignal(undefined)
        }
      },

      stop: () => abortController?.abort(),

      clearChat: () => {
        apiHistory = []
        setLiftAttachment(null)
        set({ chat: [], taskProgress: null, error: null, failChips: [], liftPhotoName: null, liftAttachmentKind: null })
      },
      hydrateDirectorChat: () => {
        const chat = useProjectStore.getState().directorChat
        apiHistory = chat.map((entry): AgentMessage =>
          entry.role === 'user'
            ? { role: 'user', text: entry.text }
            : { role: 'assistant', text: entry.text, toolCalls: [] },
        )
        set({ chat, failChips: [] })
      },
    }),
    {
      name: 'rig-agent-settings',
      version: 6,
      partialize: (s) => {
        const signedIn = Boolean(localStorage.getItem(CLOUD_ACCESS_TOKEN_KEY)?.trim())
        return {
          provider: s.provider,
          models: s.models,
          visionMode: s.visionMode,
          guidelines: s.guidelines,
          falKey: signedIn ? '' : s.falKey,
          samImageVersion: s.samImageVersion,
        }
      },
      /**
       * v6 removes browser-side LLM keys and the Kimi provider: the Director
       * now runs only on the deployment's Anthropic site key. Any persisted
       * `keys` blob is dropped rather than migrated — leaving it would keep a
       * vendor credential in localStorage that no UI can see or clear.
       */
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Record<string, unknown>
        if ('vision' in p && !('visionMode' in p)) {
          p.visionMode = p.vision === false ? 'off' : 'auto'
          delete p.vision
        }
        const persistedModels = (p.models ?? {}) as Record<string, string>
        return {
          provider: 'anthropic' as ProviderKind,
          models: { anthropic: persistedModels.anthropic || defaultModels.anthropic },
          visionMode: (p.visionMode as VisionMode) ?? 'auto',
          guidelines: (p.guidelines as string) ?? '',
          falKey: typeof p.falKey === 'string' ? p.falKey : '',
          samImageVersion: (p.samImageVersion === '3.0' ? '3.0' : '3.1') as SamImageVersion,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return
        syncFalSettings(state.falKey, state.samImageVersion)
        configureFal(state.falKey)
      },
    },
  ),
)
