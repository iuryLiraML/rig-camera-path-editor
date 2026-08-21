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
  type ProviderKind,
} from '../lib/agent/providers'
import type { VisionMode } from '../state/useAgentStore'
import type { SamImageVersion } from '../lib/fal/models'
import { Row, Section, Segmented } from './primitives'

const PROVIDER_OPTIONS = (Object.keys(PROVIDERS) as ProviderKind[]).map((k) => ({
  value: k,
  label: PROVIDERS[k].label,
}))

export function SettingsDialog() {
  const open = useEditorStore((s) => s.showSettings)
  const provider = useAgentStore((s) => s.provider)
  const keys = useAgentStore((s) => s.keys)
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
  const credentialId = useCloudAuthStore((s) => s.credentialIds?.[provider])

  useEffect(() => {
    if (!open) return
    const apiKey = keys[provider]
    // no personal key needed when the deployment has a site key — the model
    // list then loads through the same-origin /api proxy
    if (!apiKey && !serverKeys[provider]) {
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
        const options = await listProviderModels(provider, apiKey, controller.signal)
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
  }, [agent, keys, models, open, provider, serverKeys])

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
        <Section title="Deployment keys (Vercel)">
          <p className="text-[10px] leading-relaxed text-ink-dim">
            Shared Anthropic, Kimi and Fal keys belong in the Vercel project as server
            environment variables — never in this dialog for the site key, and never as{' '}
            <span className="font-mono">VITE_*</span> (those are baked into the public
            bundle). After you add them, Redeploy. This list only reports whether the
            current deployment can see them.
          </p>
          <ul className="mt-1 space-y-1 text-[11px] text-ink">
            {(
              [
                ['Anthropic', 'ANTHROPIC_API_KEY', serverKeys.anthropic],
                ['Kimi', 'KIMI_API_KEY', serverKeys.kimi],
                ['Fal', 'FAL_KEY', serverKeys.fal],
              ] as const
            ).map(([label, envVar, on]) => (
              <li key={envVar} className="flex items-baseline justify-between gap-3">
                <span>
                  {label}{' '}
                  <span className="font-mono text-[10px] text-ink-dim">{envVar}</span>
                </span>
                <span className={on ? 'text-emerald-400' : 'text-ink-dim'}>
                  {on ? 'on this deployment' : 'not set'}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={cloudStatus === 'signed-in' ? 'AI provider (session only; store in your vault)' : 'AI provider (stored locally in this browser)'}>
          <Row label="Provider">
            <Segmented<ProviderKind>
              options={PROVIDER_OPTIONS}
              value={provider}
              onChange={(v) => agent.setProvider(v)}
            />
          </Row>
          <Row label="API key">
            <input
              type="password"
              value={keys[provider]}
              onChange={(e) => agent.setKey(provider, e.target.value.trim())}
              placeholder={serverKeys[provider] ? 'Using the site key — optional override' : PROVIDERS[provider].keyHint}
              className="w-full min-w-0 rounded-md bg-panel-2 px-2 py-1 text-[11px] text-ink outline-none"
            />
          </Row>
          {serverKeys[provider] && !keys[provider].trim() && (
            <div className="text-[10px] leading-relaxed text-ink-dim">
              This deployment has a shared {PROVIDERS[provider].label} key — requests go
              through the site, and the key never reaches the browser. Paste your own key
              to use it instead.
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
                <option value={models[provider]}>
                  {modelsError ? 'Models unavailable' : 'Add an API key to load models'}
                </option>
              )}
              {!modelsLoading &&
                modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label === model.id ? model.id : `${model.label} — ${model.id}`}
                  </option>
                ))}
            </select>
          </Row>
          {modelsError && <div className="text-[10px] text-red-400">{modelsError}. Check the API key.</div>}
          {cloudStatus === 'signed-in' && (
            <div className="space-y-1.5">
              <button
                type="button"
                disabled={vaultBusy || !keys[provider].trim()}
                onClick={() => {
                  setVaultBusy(true)
                  setVaultMessage(null)
                  void useCloudAuthStore
                    .getState()
                    .storeCredential(provider, keys[provider].trim())
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
                {vaultBusy ? 'Storing…' : 'Store key in encrypted cloud vault'}
              </button>
              {credentialId && (
                <div className="text-[10px] text-ink-dim">
                  Vault credential: <span className="font-mono">{credentialId.slice(0, 8)}…</span>
                </div>
              )}
              {vaultMessage && <div className="text-[10px] text-ink-dim">{vaultMessage}</div>}
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
