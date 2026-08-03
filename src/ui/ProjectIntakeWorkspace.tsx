import { useEffect, useMemo, useRef, useState } from 'react'
import { AssetIntakeStep } from './AssetIntakeStep'
import { BriefSourceStep } from './BriefSourceStep'
import { BriefReviewStep } from './BriefReviewStep'
import { DirectorInterviewStep } from './DirectorInterviewStep'
import { GuidelinesReviewStep } from './GuidelinesReviewStep'
import { PrdReviewStep } from './PrdReviewStep'
import { ShotListReviewStep } from './ShotListReviewStep'
import { SubjectConfirmationStep } from './SubjectConfirmationStep'
import {
  completeProjectFoundation,
  nextRequiredProjectAction,
  updateProjectFoundation,
  type FoundationErrors,
} from '../lib/projectWorkflow'
import { saveActiveProject } from '../lib/projects'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'

const steps = [
  { id: 'foundation', label: 'Project foundation' },
  { id: 'brief-source', label: 'Client brief' },
  { id: 'interview', label: 'Director interview' },
  { id: 'brief-review', label: 'Brief approval' },
  { id: 'asset-intake', label: 'Scene assets' },
  { id: 'subject-confirmation', label: 'Subject confirmation' },
  { id: 'guidelines-review', label: 'Direction guidelines' },
  { id: 'prd-review', label: 'Production plan' },
  { id: 'shot-list-review', label: 'Shot list' },
] as const

function Field({
  id,
  label,
  description,
  error,
  children,
}: {
  id: string
  label: string
  description?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {description && <p className="mt-1 text-xs leading-5 text-ink-dim">{description}</p>}
      <div className="mt-2">{children}</div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

function UpcomingStep({ action }: { action: Exclude<ReturnType<typeof nextRequiredProjectAction>, 'foundation' | 'editor'> }) {
  const step = steps.find((item) => item.id === action)
  return (
    <main className="flex min-w-0 flex-1 items-center justify-center overflow-auto px-6 py-12">
      <div className="w-full max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Foundation saved</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">{step?.label}</h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-ink-dim">
          Your project draft is safe. This screen is the next workflow slice and remains locked until
          its local parsing, provenance, and recovery behavior are implemented.
        </p>
        <button
          type="button"
          onClick={() => useEditorStore.getState().setAppView('projects')}
          className="mt-8 rounded-lg border border-line bg-panel-2 px-4 py-2 text-sm text-ink hover:bg-panel-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Return to projects
        </button>
      </div>
    </main>
  )
}

export function ProjectIntakeWorkspace() {
  const name = useProjectStore((state) => state.name)
  const workflow = useProjectStore((state) => state.workflow)
  const [errors, setErrors] = useState<FoundationErrors>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // The workflow decides which step is REQUIRED next; `revisiting` lets the user
  // step back into an already-completed screen to fix an earlier answer.
  const [revisiting, setRevisiting] = useState<(typeof steps)[number]['id'] | null>(null)
  const requiredAction = nextRequiredProjectAction(workflow)
  const requiredIndex = useMemo(
    () => Math.max(0, steps.findIndex((step) => step.id === requiredAction)),
    [requiredAction],
  )
  // Follow the workflow again only when it ADVANCES. Editing a revisited step
  // often moves the required step backwards (e.g. touching the foundation resets
  // it to 'draft'); clearing the override there would eject the user mid-edit.
  const lastRequiredIndex = useRef(requiredIndex)
  useEffect(() => {
    if (requiredIndex > lastRequiredIndex.current) setRevisiting(null)
    lastRequiredIndex.current = requiredIndex
  }, [requiredIndex])

  const action = revisiting ?? requiredAction
  const currentIndex = useMemo(
    () => Math.max(0, steps.findIndex((step) => step.id === action)),
    [action],
  )

  const updateFoundation = (
    patch: Parameters<typeof updateProjectFoundation>[1],
  ) => {
    useProjectStore.getState().setWorkflow(updateProjectFoundation(workflow, patch))
    setErrors((current) => {
      const next = { ...current }
      if ('client' in patch) delete next.client
      if ('deliverable' in patch) delete next.deliverable
      if ('targetDurationSeconds' in patch) delete next.targetDurationSeconds
      return next
    })
  }

  const saveDraft = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await saveActiveProject()
    } catch {
      setSaveError('Draft could not be saved. Check browser storage and try again.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Setup is context, not a gate: unlock the editor and keep whatever the user
   * already filled in, so they can resume the remaining steps later.
   */
  const skipToEditor = async () => {
    setSaveError(null)
    const previousWorkflow = useProjectStore.getState().workflow
    useProjectStore.getState().setWorkflow({ ...previousWorkflow, legacyEditorAccess: true })
    useEditorStore.getState().setAppView('editor')
    try {
      await saveActiveProject()
    } catch {
      setSaveError('Editor unlocked, but the project could not be saved.')
    }
  }

  const continueFromFoundation = async () => {
    const result = completeProjectFoundation(useProjectStore.getState().workflow)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setSaveError(null)
    const previousWorkflow = useProjectStore.getState().workflow
    useProjectStore.getState().setWorkflow(result.workflow)
    try {
      await saveActiveProject()
    } catch {
      useProjectStore.getState().setWorkflow(previousWorkflow)
      setSaveError('Foundation could not be saved, so the workflow did not advance.')
    }
  }

  return (
    <div className="relative flex h-full w-full select-text bg-[#0f0f11] text-ink selection:bg-accent/30">
      {/* narrow layout: the step sidebar is hidden below xl, so surface the
          current step plus back/forward navigation here */}
      <div className="absolute left-4 right-4 top-4 z-10 flex items-center justify-between gap-3 xl:hidden">
        <button
          type="button"
          onClick={() => useEditorStore.getState().setAppView('projects')}
          className="shrink-0 text-xs text-ink-dim hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ← All projects
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={currentIndex === 0}
            onClick={() => setRevisiting(steps[Math.max(0, currentIndex - 1)].id)}
            title="Previous step"
            className="rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink hover:bg-panel-3 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ◀
          </button>
          <span className="whitespace-nowrap text-xs text-ink-dim">
            Step {currentIndex + 1}/{steps.length} · {steps[currentIndex]?.label}
          </span>
          <button
            type="button"
            disabled={currentIndex >= requiredIndex}
            onClick={() => setRevisiting(steps[Math.min(steps.length - 1, currentIndex + 1)].id)}
            title="Next step"
            className="rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink hover:bg-panel-3 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ▶
          </button>
        </div>
        <button
          type="button"
          onClick={() => void skipToEditor()}
          className="shrink-0 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs text-ink hover:bg-panel-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Skip to editor →
        </button>
      </div>
      <aside className="hidden w-72 shrink-0 border-r border-line/80 bg-panel px-5 py-6 xl:flex xl:flex-col">
        <button
          type="button"
          onClick={() => useEditorStore.getState().setAppView('projects')}
          className="w-fit text-xs text-ink-dim hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ← All projects
        </button>
        <div className="mt-8">
          <p className="truncate text-sm font-semibold text-ink">{name || 'Untitled project'}</p>
          <p className="mt-1 text-xs text-ink-dim">Setup draft</p>
        </div>
        <nav aria-label="Project setup progress" className="mt-8">
          <ol className="space-y-1">
            {steps.map((step, index) => {
              const active = index === currentIndex
              const complete = index < requiredIndex
              // any step already reached can be reopened to correct an answer
              const reachable = index <= requiredIndex
              return (
                <li key={step.id} aria-current={active ? 'step' : undefined}>
                  <button
                    type="button"
                    disabled={!reachable}
                    onClick={() => setRevisiting(step.id)}
                    title={reachable ? `Open ${step.label}` : 'Complete the previous steps first'}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs ${
                      active ? 'bg-panel-3 text-ink' : 'text-ink-dim'
                    } ${reachable ? 'hover:bg-panel-2 hover:text-ink' : 'cursor-not-allowed opacity-60'}`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                        active || complete ? 'border-accent text-accent' : 'border-line'
                      }`}
                    >
                      {complete ? '✓' : index + 1}
                    </span>
                    {step.label}
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>
        <div className="mt-auto space-y-3">
          <p className="text-xs leading-5 text-ink-dim">
            Setup is optional — it only gives the director agent context. You can jump into the
            editor at any point and come back to it later.
          </p>
          <button
            type="button"
            onClick={() => void skipToEditor()}
            className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-ink hover:bg-panel-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Skip to editor →
          </button>
        </div>
      </aside>

      {/* Revisiting a completed step: its primary action is idempotent and would
          look like a no-op, so say where we are and offer the way back. */}
      {revisiting && revisiting !== requiredAction && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-panel/95 px-4 py-2 text-xs text-ink-dim shadow-lg backdrop-blur">
            <span>
              Revisiting a completed step — changes are saved as you go.
            </span>
            <button
              type="button"
              onClick={() => setRevisiting(null)}
              className="rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Back to step {requiredIndex + 1} →
            </button>
          </div>
        </div>
      )}

      {action === 'foundation' ? (
        <main className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10 lg:py-16">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
                  Project setup · Step 1
                </p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">
                  Establish the production foundation
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-dim">
                  These facts anchor the interview. The director agent will ask about style,
                  constraints, prohibited moves, framing, and delivery requirements next.
                </p>
              </div>
              <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-dim">
                Draft
              </span>
            </div>

            <form
              className="mt-10 space-y-7"
              onSubmit={(event) => {
                event.preventDefault()
                void continueFromFoundation()
              }}
            >
              <Field id="project-name" label="Project name">
                <input
                  id="project-name"
                  value={name}
                  onChange={(event) => useProjectStore.getState().setName(event.target.value)}
                  className="w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </Field>

              <div className="grid gap-7 md:grid-cols-2">
                <Field id="project-client" label="Client or brand" error={errors.client}>
                  <input
                    id="project-client"
                    value={workflow.foundation.client}
                    aria-invalid={Boolean(errors.client)}
                    aria-describedby={errors.client ? 'project-client-error' : undefined}
                    onChange={(event) => updateFoundation({ client: event.target.value })}
                    placeholder="Acme"
                    className="w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-dim/60 focus:border-accent focus:ring-1 focus:ring-accent"
                  />
                </Field>
                <Field id="project-deliverable" label="Primary deliverable" error={errors.deliverable}>
                  <input
                    id="project-deliverable"
                    value={workflow.foundation.deliverable}
                    aria-invalid={Boolean(errors.deliverable)}
                    aria-describedby={errors.deliverable ? 'project-deliverable-error' : undefined}
                    onChange={(event) => updateFoundation({ deliverable: event.target.value })}
                    placeholder="30-second product film"
                    className="w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-dim/60 focus:border-accent focus:ring-1 focus:ring-accent"
                  />
                </Field>
              </div>

              <Field
                id="project-channels"
                label="Target channels"
                description="Separate channels with commas. They will inform aspect ratios and safe areas."
              >
                <input
                  id="project-channels"
                  value={workflow.foundation.targetChannels.join(', ')}
                  onChange={(event) =>
                    updateFoundation({
                      targetChannels: event.target.value.split(','),
                    })
                  }
                  placeholder="Instagram Reels, YouTube, website"
                  className="w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-dim/60 focus:border-accent focus:ring-1 focus:ring-accent"
                />
              </Field>

              {/* Duration is not asked here on purpose: it is set later in the
                  editor (Camera › Duration), which is the real source of truth. */}

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveDraft()}
                  className="rounded-lg border border-line bg-panel px-4 py-2 text-sm text-ink hover:bg-panel-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {saving ? 'Saving…' : 'Save draft'}
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f11]"
                >
                  Save and add brief
                </button>
              </div>
              {saveError && (
                <p role="alert" className="text-sm text-red-400">
                  {saveError}
                </p>
              )}
            </form>
          </div>
        </main>
      ) : action === 'brief-source' ? (
        <BriefSourceStep />
      ) : action === 'interview' ? (
        <DirectorInterviewStep />
      ) : action === 'brief-review' ? (
        <BriefReviewStep />
      ) : action === 'asset-intake' ? (
        <AssetIntakeStep />
      ) : action === 'subject-confirmation' ? (
        <SubjectConfirmationStep />
      ) : action === 'guidelines-review' ? (
        <GuidelinesReviewStep />
      ) : action === 'prd-review' ? (
        <PrdReviewStep />
      ) : action === 'shot-list-review' ? (
        <ShotListReviewStep />
      ) : action === 'editor' ? null : (
        <UpcomingStep action={action} />
      )}
    </div>
  )
}
