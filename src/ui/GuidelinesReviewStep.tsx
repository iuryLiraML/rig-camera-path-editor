import { useEffect, useRef, useState } from 'react'
import { generateGuidelinesArtifact } from '../lib/agent/runDirectionArtifacts'
import { PROVIDERS } from '../lib/agent/providers'
import {
  approveGuidelines,
  setGuidelinesDraft,
  setGuidelinesGenerating,
} from '../lib/projectWorkflow'
import { saveActiveProject } from '../lib/projects'
import { syncActiveProjectToCloud } from '../lib/cloud/sync'
import { makeSceneId } from '../state/useSceneStore'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { useAbortableRun } from './useAbortableRun'

export function GuidelinesReviewStep() {
  const workflow = useProjectStore((state) => state.workflow)
  const provider = useAgentStore((state) => state.provider)
  const apiKey = useAgentStore((state) => state.keys[state.provider])
  const model = useAgentStore((state) => state.models[state.provider])
  const [draft, setDraft] = useState(workflow.guidelines.draft ?? '')
  const [skillName, setSkillName] = useState(workflow.guidelines.skillName ?? '')
  const [skillBody, setSkillBody] = useState(workflow.guidelines.skillBody ?? '')
  const [status, setStatus] = useState<'idle' | 'generating'>('idle')
  const { run, cancel } = useAbortableRun()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const startedRef = useRef(false)

  const hasKey = apiKey.trim().length > 0
  const needsGeneration =
    !workflow.guidelines.draft?.trim() &&
    workflow.guidelines.status !== 'review-required' &&
    workflow.guidelines.status !== 'approved'

  const persist = async (next: ReturnType<typeof useProjectStore.getState>['workflow']) => {
    const previous = useProjectStore.getState().workflow
    useProjectStore.getState().setWorkflow(next)
    try {
      await saveActiveProject()
      await syncActiveProjectToCloud().catch(() => undefined)
    } catch {
      useProjectStore.getState().setWorkflow(previous)
      throw new Error('Guidelines could not be saved.')
    }
  }

  const generate = async () => {
    const trimmedKey = apiKey.trim()
    if (!trimmedKey) {
      setError(`Add your ${PROVIDERS[provider].label} API key in Settings first.`)
      return
    }

    setStatus('generating')
    setError(null)
    const previous = useProjectStore.getState().workflow
    useProjectStore.getState().setWorkflow(setGuidelinesGenerating(previous))

    try {
      const outcome = await run((signal) =>
        generateGuidelinesArtifact(previous, { provider, apiKey: trimmedKey, model }, signal),
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
      const next = setGuidelinesDraft(previous, {
        draft: result.draft,
        skillName: result.skillName,
        skillBody: result.skillBody,
        skillId: previous.guidelines.skillId,
      })
      await persist(next)
      setDraft(result.draft)
      setSkillName(result.skillName)
      setSkillBody(result.skillBody)
    } catch (cause) {
      useProjectStore.getState().setWorkflow(previous)
      setError(cause instanceof Error ? cause.message : 'Guidelines generation failed')
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
      setError('Guidelines text is required before approval.')
      return
    }

    setSaving(true)
    setError(null)
    const previous = useProjectStore.getState().workflow
    const skillId = previous.guidelines.skillId ?? makeSceneId('skill')
    const withDraft = setGuidelinesDraft(previous, {
      draft,
      skillName: skillName || 'Project direction',
      skillBody: skillBody || draft,
      skillId,
    })
    const approved = approveGuidelines(withDraft, skillId)
    useProjectStore.getState().setWorkflow(approved)
    useProjectStore.getState().setGuidelines(approved.guidelines.draft ?? '')
    useProjectStore.getState().upsertSkill({
      id: skillId,
      name: approved.guidelines.skillName ?? 'Project direction',
      description: 'Auto-generated project direction skill from intake',
      body: approved.guidelines.skillBody ?? approved.guidelines.draft ?? '',
    })

    try {
      await saveActiveProject()
      await syncActiveProjectToCloud().catch(() => undefined)
    } catch {
      useProjectStore.getState().setWorkflow(previous)
      setError('Guidelines approval could not be saved.')
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
              Project setup · Step 7
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">
              Approve direction guidelines
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-dim">
              These rules become both the project guidelines injected into the editor assistant and
              an auto-generated project skill for reusable camera recipes.
            </p>
          </div>
          <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-dim">
            {status === 'generating' ? 'Generating…' : workflow.guidelines.status}
          </span>
        </div>

        {/* A key is only needed to GENERATE — writing the guidelines by hand is
            always allowed, so the form stays available either way. */}
        {!hasKey && (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3">
            <p className="text-xs text-ink-dim">
              Add an AI provider key to generate a draft — or write the guidelines yourself below.
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
              <label htmlFor="guidelines-draft" className="block text-sm font-medium text-ink">
                Direction guidelines
              </label>
              <textarea
                id="guidelines-draft"
                rows={14}
                value={draft}
                disabled={status === 'generating'}
                onChange={(event) => setDraft(event.target.value)}
                className="mt-2 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-sm leading-6 text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60"
              />
            </div>

            <div>
              <label htmlFor="skill-name" className="block text-sm font-medium text-ink">
                Project skill name
              </label>
              <input
                id="skill-name"
                value={skillName}
                disabled={status === 'generating'}
                onChange={(event) => setSkillName(event.target.value)}
                className="mt-2 w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60"
              />
            </div>

            <div>
              <label htmlFor="skill-body" className="block text-sm font-medium text-ink">
                Project skill recipe
              </label>
              <textarea
                id="skill-body"
                rows={10}
                value={skillBody}
                disabled={status === 'generating'}
                onChange={(event) => setSkillBody(event.target.value)}
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
                {saving ? 'Saving…' : 'Approve guidelines and continue'}
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
