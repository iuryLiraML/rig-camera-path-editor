import { useState } from 'react'
import { approveCreativeBrief } from '../lib/projectWorkflow'
import { saveActiveProject } from '../lib/projects'
import { syncActiveProjectToCloud } from '../lib/cloud/sync'
import { useProjectStore } from '../state/useProjectStore'

export function BriefReviewStep() {
  const workflow = useProjectStore((state) => state.workflow)
  const [draft, setDraft] = useState(workflow.brief.draft ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const approveBrief = async () => {
    if (!draft.trim()) {
      setError('Creative brief text is required before approval.')
      return
    }

    setSaving(true)
    setError(null)
    const previous = useProjectStore.getState().workflow
    const withDraft = {
      ...previous,
      brief: {
        ...previous.brief,
        draft: draft.trim(),
      },
    }
    const approved = approveCreativeBrief(withDraft)
    useProjectStore.getState().setWorkflow(approved)

    try {
      await saveActiveProject()
      await syncActiveProjectToCloud().catch(() => undefined)
    } catch {
      useProjectStore.getState().setWorkflow(previous)
      setError('Brief approval could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10 lg:py-16">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Project setup · Step 4
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">
            Approve the creative brief
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-dim">
            Review the synthesized brief from the director interview. Edit anything that needs
            tightening before moving to scene assets.
          </p>
        </div>

        <div className="mt-10">
          <label htmlFor="creative-brief" className="block text-sm font-medium text-ink">
            Creative brief
          </label>
          <textarea
            id="creative-brief"
            rows={18}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="mt-2 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-sm leading-6 text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
          <p className="text-xs text-ink-dim">
            {workflow.interview.transcript.length} interview turns captured
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={() => void approveBrief()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Approve brief and continue'}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-400">
            {error}
          </p>
        )}
      </div>
    </main>
  )
}
