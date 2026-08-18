import { useEffect, useRef, useState } from 'react'
import { generatePrdArtifact } from '../lib/agent/runDirectionArtifacts'
import { PROVIDERS } from '../lib/agent/providers'
import { approvePrd, setPrdDraft, setPrdGenerating } from '../lib/projectWorkflow'
import { saveActiveProject } from '../lib/projects'
import { syncActiveProjectToCloud } from '../lib/cloud/sync'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { useAbortableRun } from './useAbortableRun'

export function PrdReviewStep() {
  const workflow = useProjectStore((state) => state.workflow)
  const provider = useAgentStore((state) => state.provider)
  const apiKey = useAgentStore((state) => state.keys[state.provider])
  const serverKey = useAgentStore((state) => state.serverKeys[state.provider])
  const model = useAgentStore((state) => state.models[state.provider])
  const [draft, setDraft] = useState(workflow.prd.draft ?? '')
  const [status, setStatus] = useState<'idle' | 'generating'>('idle')
  const { run, cancel } = useAbortableRun()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const startedRef = useRef(false)

  const hasKey = apiKey.trim().length > 0 || serverKey
  const needsGeneration =
    !workflow.prd.draft?.trim() &&
    workflow.prd.status !== 'review-required' &&
    workflow.prd.status !== 'approved'

  const persist = async (next: ReturnType<typeof useProjectStore.getState>['workflow']) => {
    const previous = useProjectStore.getState().workflow
    useProjectStore.getState().setWorkflow(next)
    try {
      await saveActiveProject()
      await syncActiveProjectToCloud().catch(() => undefined)
    } catch {
      useProjectStore.getState().setWorkflow(previous)
      throw new Error('PRD could not be saved.')
    }
  }

  const generate = async () => {
    const trimmedKey = apiKey.trim()
    if (!trimmedKey && !serverKey) {
      setError(`Add your ${PROVIDERS[provider].label} API key in Settings first.`)
      return
    }

    setStatus('generating')
    setError(null)
    const previous = useProjectStore.getState().workflow
    useProjectStore.getState().setWorkflow(setPrdGenerating(previous))

    try {
      const outcome = await run((signal) =>
        generatePrdArtifact(previous, { provider, apiKey: trimmedKey, model }, signal),
      )
      if (!outcome.ok) {
        useProjectStore.getState().setWorkflow(previous)
        if (outcome.reason === 'timeout') {
          setError('The provider did not answer in time. Try again.')
        } else if (outcome.reason === 'aborted') {
          setError('Generation cancelled.')
        } else if (outcome.reason === 'error') {
          throw outcome.error
        }
        return
      }
      const result = outcome.value
      const next = setPrdDraft(previous, result.draft)
      await persist(next)
      setDraft(result.draft)
    } catch (cause) {
      useProjectStore.getState().setWorkflow(previous)
      setError(cause instanceof Error ? cause.message : 'PRD generation failed')
    } finally {
      setStatus('idle')
    }
  }

  useEffect(() => {
    if (startedRef.current) return
    if (!needsGeneration || !hasKey) return
    startedRef.current = true
    void generate()
  }, [needsGeneration, hasKey])

  const approve = async () => {
    if (!draft.trim()) {
      setError('PRD text is required before approval.')
      return
    }

    setSaving(true)
    setError(null)
    const previous = useProjectStore.getState().workflow
    const withDraft = setPrdDraft(previous, draft)
    const approved = approvePrd(withDraft)
    useProjectStore.getState().setWorkflow(approved)

    try {
      await saveActiveProject()
      await syncActiveProjectToCloud().catch(() => undefined)
    } catch {
      useProjectStore.getState().setWorkflow(previous)
      setError('PRD approval could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10 lg:py-16">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
              Project setup · Step 8
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">
              Approve the production plan
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-dim">
              The PRD consolidates objective, camera language, constraints, and a suggested shot
              outline before the formal shot list is authored.
            </p>
          </div>
          <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-dim">
            {status === 'generating' ? 'Generating…' : workflow.prd.status}
          </span>
        </div>

        {/* A key is only needed to GENERATE — the PRD can always be written by hand. */}
        {!hasKey && (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3">
            <p className="text-xs text-ink-dim">
              Add an AI provider key to generate a draft — or write the PRD yourself below.
            </p>
            <button
              type="button"
              onClick={() => useEditorStore.getState().setShowSettings(true)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
            >
              Open Settings
            </button>
          </div>
        )}
        {(
          <div className="mt-10 space-y-7">
            <div>
              <label htmlFor="prd-draft" className="block text-sm font-medium text-ink">
                Production PRD
              </label>
              <textarea
                id="prd-draft"
                rows={20}
                value={draft}
                disabled={status === 'generating'}
                onChange={(event) => setDraft(event.target.value)}
                className="mt-2 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-sm leading-6 text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
              {status === 'generating' && (
              <button
                type="button"
                onClick={() => {
                  if (cancel()) {
                    useProjectStore.getState().setWorkflow(useProjectStore.getState().workflow)
                    setStatus('idle')
                    setError('Generation cancelled.')
                  }
                }}
                className="rounded-lg border border-line bg-panel-2 px-4 py-2 text-sm text-ink hover:bg-panel-3"
              >
                Cancel
              </button>
              )}
              <button
                type="button"
                disabled={status === 'generating' || saving || !hasKey}
                title={hasKey ? undefined : 'Add an AI provider key to generate'}
                onClick={() => void generate()}
                className="rounded-lg border border-line bg-panel px-4 py-2 text-sm text-ink hover:bg-panel-2 disabled:opacity-50"
              >
                {status === 'generating' ? 'Generating…' : 'Regenerate'}
              </button>
              <button
                type="button"
                disabled={status === 'generating' || saving || !draft.trim()}
                onClick={() => void approve()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Approve PRD and continue'}
              </button>
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
