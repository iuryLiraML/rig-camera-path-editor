import { useEffect, useState } from 'react'
import { useAgentStore } from '../state/useAgentStore'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import {
  listProviderModels,
  modelSupportsVision,
  PROVIDERS,
  type ModelOption,
} from '../lib/agent/providers'
import type { VisionMode } from '../state/useAgentStore'
import type { SamImageVersion } from '../lib/fal/models'
import { fetchSessionEmail } from '../lib/siteSession'
import { Row, Section, Segmented } from './primitives'

export function SettingsDialog() {
  const open = useEditorStore((s) => s.showSettings)
  const provider = useAgentStore((s) => s.provider)
  const models = useAgentStore((s) => s.models)
  const visionMode = useAgentStore((s) => s.visionMode)
  const falKey = useAgentStore((s) => s.falKey)
  const samImageVersion = useAgentStore((s) => s.samImageVersion)
  const serverKeys = useAgentStore((s) => s.serverKeys)
  const guidelines = useProjectStore((s) => s.guidelines)
  const projectName = useProjectStore((s) => s.name)
  const agent = useAgentStore.getState()
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [vaultBusy, setVaultBusy] = useState(false)
  const [vaultMessage, setVaultMessage] = useState<string | null>(null)
  const cloudStatus = useCloudAuthStore((s) => s.status)
  // site-access session (the Google login gate) — null when there is no gate
  const [siteEmail, setSiteEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    void fetchSessionEmail().then((email) => {
      if (live) setSiteEmail(email)
    })
    return () => {
      live = false
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    // the model list loads through the same-origin /api proxy, so it needs the
    // deployment's site key and nothing else
    if (!serverKeys[provider]) {
      setModelOptions([])
      setModelsError(null)
      setModelsLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setModelsLoading(true)
      setModelsError(null)
      try {
        const options = await listProviderModels(provider, controller.signal)
        setModelOptions(options)
        const selected = models[provider]
        if (options.length > 0 && !options.some((option) => option.id === selected)) {
          agent.setModel(provider, options[0].id)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setModelOptions([])
          setModelsError(error instanceof Error ? error.message : 'Unable to load models')
        }
      } finally {
        if (!controller.signal.aborted) setModelsLoading(false)
      }
    }, 350)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [agent, models, open, provider, serverKeys])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) useEditorStore.getState().setShowSettings(false)
      }}
    >
      <div className="panel flex max-h-[min(90vh,720px)] w-[420px] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line/60 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Settings</h2>
          <button
            onClick={() => useEditorStore.getState().setShowSettings(false)}
            className="text-ink-dim hover:text-ink"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
        {siteEmail && (
          <Section title="Site access">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[11px] text-ink" title={siteEmail}>
                  {siteEmail}
                </div>
                <div className="text-[10px] text-ink-dim">Signed in to this site with Google</div>
              </div>
              {/* a real navigation, not fetch(): the server clears the cookie and
                  serves the signed-out page, which lives outside the gate */}
              <a
                href="/api/auth/logout"
                className="shrink-0 rounded-md bg-panel-2 px-2.5 py-1.5 text-[11px] text-ink hover:bg-panel-3"
              >
                Sign out of Rig
              </a>
            </div>
          </Section>
        )}

        <Section title="Director model">
          {!serverKeys[provider] ? (
            <div className="rounded-md bg-red-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-red-300">
              No {PROVIDERS[provider].label} key is configured on this deployment, so the
              Director cannot run. Set <span className="font-mono">ANTHROPIC_API_KEY</span> in
              the Vercel project and redeploy.
            </div>
          ) : (
            <div className="text-[10px] leading-relaxed text-ink-dim">
              The Director runs on this deployment's shared {PROVIDERS[provider].label} key.
              Requests go through the site and the key never reaches the browser.
            </div>
          )}
          <Row label="Model">
            <select
              value={models[provider]}
              onChange={(e) => agent.setModel(provider, e.target.value)}
              disabled={modelsLoading || modelOptions.length === 0}
              className="w-full min-w-0 rounded-md bg-panel-2 px-2 py-1 text-[11px] text-ink outline-none disabled:cursor-not-allowed disabled:text-ink-dim"
            >
              {modelsLoading && <option value={models[provider]}>Loading models…</option>}
              {!modelsLoading && modelOptions.length === 0 && (
                <option value={models[provider]}>Models unavailable</option>
              )}
              {!modelsLoading &&
                modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label === model.id ? model.id : `${model.label} — ${model.id}`}
                  </option>
                ))}
            </select>
          </Row>
          {modelsError && (
            <div className="text-[10px] text-red-400">
              {modelsError}. The deployment's key may be invalid.
            </div>
          )}
          <Row label="Screenshot">
            <Segmented<VisionMode>
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
              value={visionMode}
              onChange={(v) => agent.setVisionMode(v)}
            />
          </Row>
          <div className="text-[10px] leading-relaxed text-ink-dim">
            {visionMode === 'auto'
              ? `Auto: ${
                  modelSupportsVision(provider, models[provider] || PROVIDERS[provider].defaultModel)
                    ? 'this model looks vision-capable — the viewport is sent when no chat photo is attached'
                    : 'this model looks text-only — the viewport is not sent'
                }. Chat photos are always sent to vision models.`
              : visionMode === 'on'
                ? modelSupportsVision(provider, models[provider] || PROVIDERS[provider].defaultModel)
                  ? 'The viewport screenshot is sent when no chat photo is attached. A Photo in chat replaces it.'
                  : 'This model looks text-only — the screenshot is skipped to avoid a 400, even though Screenshot is set to On.'
                : 'The viewport screenshot is never sent. A Photo attached in chat is still sent to vision models.'}
          </div>
        </Section>

        <Section title={cloudStatus === 'signed-in' ? 'Photo and video lift (Fal, session only)' : 'Photo and video lift (Fal, stored locally in this browser)'}>
          <Row label="Fal key">
            <input
              type="password"
              value={falKey}
              onChange={(e) => agent.setFalKey(e.target.value.trim())}
              placeholder={serverKeys.fal ? 'Using the site key — optional override' : 'key-…'}
              className="w-full min-w-0 rounded-md bg-panel-2 px-2 py-1 text-[11px] text-ink outline-none"
            />
          </Row>
          {serverKeys.fal && !falKey.trim() && (
            <div className="text-[10px] leading-relaxed text-ink-dim">
              This deployment has a shared Fal key — lifts go through the site, and the
              key never reaches the browser. Paste your own key to use it instead.
            </div>
          )}
          {cloudStatus === 'signed-in' && (
            <button
              type="button"
              disabled={vaultBusy || !falKey.trim()}
              onClick={() => {
                setVaultBusy(true)
                setVaultMessage(null)
                void useCloudAuthStore
                  .getState()
                  .storeCredential('fal', falKey.trim())
                  .then((id) => {
                    setVaultMessage(`Stored in vault (${id.slice(0, 8)}…) — secret not returned.`)
                  })
                  .catch((error) => {
                    setVaultMessage(error instanceof Error ? error.message : 'Vault store failed')
                  })
                  .finally(() => setVaultBusy(false))
              }}
              className="rounded-md bg-panel-2 px-2 py-1 text-[11px] text-ink hover:bg-panel-3 disabled:opacity-50"
            >
              {vaultBusy ? 'Storing…' : 'Store Fal key in encrypted cloud vault'}
            </button>
          )}
          {vaultMessage && <div className="text-[10px] text-ink-dim">{vaultMessage}</div>}
          <Row label="Mask model">
            <Segmented<SamImageVersion>
              options={[
                { value: '3.1', label: '3.1' },
                { value: '3.0', label: '3.0' },
              ]}
              value={samImageVersion}
              onChange={(v) => agent.setSamImageVersion(v)}
            />
          </Row>
          <div className="text-[10px] leading-relaxed text-ink-dim">
            Used when you attach a photo to lift a person or a prop, or a short video
            (8 seconds or less) to lift one person with a performance clip. 3.1 is
            the default mask; 3.0 is the cheaper fallback.
          </div>
        </Section>

        <Section title={`Guidelines for "${projectName}" (given to the assistant)`}>
          <textarea
            value={guidelines}
            onChange={(e) => useProjectStore.getState().setGuidelines(e.target.value)}
            rows={6}
            placeholder={'What is the product? Brand tone, camera do’s and don’ts, references…'}
            className="w-full resize-none rounded-md bg-panel-2 px-2 py-1.5 text-[11px] leading-relaxed text-ink outline-none placeholder:text-ink-dim"
          />
        </Section>
        </div>
      </div>
    </div>
  )
}
