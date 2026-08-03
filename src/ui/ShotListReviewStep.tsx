import { useEffect, useRef, useState } from 'react'
import { generateShotListArtifact } from '../lib/agent/runDirectionArtifacts'
import { PROVIDERS } from '../lib/agent/providers'
import {
  addPlannedShot,
  approveShotList,
  CAMERA_PROFILES,
  removePlannedShot,
  setShotListDraft,
  setShotListGenerating,
  updatePlannedShot,
  type CameraProfile,
  type PlannedShot,
} from '../lib/projectWorkflow'
import { saveActiveProject } from '../lib/projects'
import { syncActiveProjectToCloud } from '../lib/cloud/sync'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { useAbortableRun } from './useAbortableRun'

const PROFILE_LABELS: Record<CameraProfile, string> = {
  packshot: 'Packshot',
  'reveal-orbit': 'Reveal / orbit',
  dolly: 'Dolly',
  'fpv-drone': 'FPV / drone',
  custom: 'Custom',
}

export function ShotListReviewStep() {
  const workflow = useProjectStore((state) => state.workflow)
  const provider = useAgentStore((state) => state.provider)
  const apiKey = useAgentStore((state) => state.keys[state.provider])
  const model = useAgentStore((state) => state.models[state.provider])
  const [summary, setSummary] = useState(workflow.shotList.summary ?? '')
  const [status, setStatus] = useState<'idle' | 'generating'>('idle')
  const { run, cancel } = useAbortableRun()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const startedRef = useRef(false)

  const shots = workflow.shotList.shots
  const hasKey = apiKey.trim().length > 0
  const needsGeneration =
    shots.length === 0 &&
    workflow.shotList.status !== 'review-required' &&
    workflow.shotList.status !== 'approved'

  const persist = async (next: ReturnType<typeof useProjectStore.getState>['workflow']) => {
    const previous = useProjectStore.getState().workflow
    useProjectStore.getState().setWorkflow(next)
    try {
      await saveActiveProject()
      await syncActiveProjectToCloud().catch(() => undefined)
    } catch {
      useProjectStore.getState().setWorkflow(previous)
      throw new Error('Shot list could not be saved.')
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
    useProjectStore.getState().setWorkflow(setShotListGenerating(previous))

    try {
      const outcome = await run((signal) =>
        generateShotListArtifact(previous, { provider, apiKey: trimmedKey, model }, signal),
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
      const next = setShotListDraft(previous, {
        shots: result.shots,
        summary: result.summary,
      })
      await persist(next)
      setSummary(result.summary ?? '')
    } catch (cause) {
      useProjectStore.getState().setWorkflow(previous)
      setError(cause instanceof Error ? cause.message : 'Shot list generation failed')
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

  const patchShot = async (shotId: string, patch: Partial<Omit<PlannedShot, 'id' | 'order'>>) => {
    const next = updatePlannedShot(useProjectStore.getState().workflow, shotId, patch)
    useProjectStore.getState().setWorkflow(next)
  }

  const deleteShot = async (shotId: string) => {
    const next = removePlannedShot(useProjectStore.getState().workflow, shotId)
    useProjectStore.getState().setWorkflow(next)
  }

  const addShot = () => {
    useProjectStore.getState().setWorkflow(addPlannedShot(useProjectStore.getState().workflow))
  }

  const approve = async () => {
    setSaving(true)
    setError(null)
    const previous = useProjectStore.getState().workflow
    const withSummary = setShotListDraft(previous, {
      shots: previous.shotList.shots,
      summary,
    })
    const result = approveShotList(withSummary)
    if (!result.ok) {
      setError(result.errors.shots ?? 'Shot list could not be approved.')
      setSaving(false)
      return
    }

    useProjectStore.getState().setWorkflow(result.workflow)
    try {
      await saveActiveProject()
      await syncActiveProjectToCloud().catch(() => undefined)
      useEditorStore.getState().setAppView('editor')
    } catch {
      useProjectStore.getState().setWorkflow(previous)
      setError('Shot list approval could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const totalDuration = shots.reduce((sum, shot) => sum + shot.durationSeconds, 0)

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10 lg:py-16">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
              Project setup · Step 9
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">
              Approve the shot list
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-dim">
              Review every planned camera move before production. Approving this list completes
              intake and opens the editor for batch generation.
            </p>
          </div>
          <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-dim">
            {status === 'generating'
              ? 'Generating…'
              : `${shots.length} shots · ${totalDuration.toFixed(1)}s`}
          </span>
        </div>

        {/* A key is only needed to GENERATE — shots can always be edited by hand. */}
        {!hasKey && (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3">
            <p className="text-xs text-ink-dim">
              Add an AI provider key to generate a shot list — or edit the shots below by hand.
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
              <label htmlFor="shot-list-summary" className="block text-sm font-medium text-ink">
                Sequence summary
              </label>
              <textarea
                id="shot-list-summary"
                rows={3}
                value={summary}
                disabled={status === 'generating'}
                onChange={(event) => setSummary(event.target.value)}
                className="mt-2 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2.5 text-sm leading-6 text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60"
              />
            </div>

            {shots.length === 0 && status === 'generating' && (
              <p className="text-sm text-ink-dim">Drafting the shot list from your approved PRD…</p>
            )}

            <ul className="space-y-4">
              {shots.map((shot, index) => (
                <li
                  key={shot.id}
                  className="rounded-xl border border-line bg-panel p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-ink-dim">
                      Shot {(index + 1) * 10}
                    </p>
                    <button
                      type="button"
                      disabled={status === 'generating'}
                      onClick={() => void deleteShot(shot.id)}
                      className="text-xs text-ink-dim hover:text-red-400 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="block text-xs text-ink-dim">Name</label>
                      <input
                        value={shot.name}
                        disabled={status === 'generating'}
                        onChange={(event) => void patchShot(shot.id, { name: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-dim">Profile</label>
                      <select
                        value={shot.profile}
                        disabled={status === 'generating'}
                        onChange={(event) =>
                          void patchShot(shot.id, {
                            profile: event.target.value as CameraProfile,
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                      >
                        {CAMERA_PROFILES.map((profile) => (
                          <option key={profile} value={profile}>
                            {PROFILE_LABELS[profile]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-[1fr_120px]">
                    <div>
                      <label className="block text-xs text-ink-dim">Intent</label>
                      <input
                        value={shot.intent}
                        disabled={status === 'generating'}
                        onChange={(event) => void patchShot(shot.id, { intent: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-dim">Duration (s)</label>
                      <input
                        type="number"
                        min="0.5"
                        step="0.5"
                        value={shot.durationSeconds}
                        disabled={status === 'generating'}
                        onChange={(event) =>
                          void patchShot(shot.id, {
                            durationSeconds: Number(event.target.value),
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="block text-xs text-ink-dim">Framing notes</label>
                    <textarea
                      rows={2}
                      value={shot.framingNotes}
                      disabled={status === 'generating'}
                      onChange={(event) =>
                        void patchShot(shot.id, { framingNotes: event.target.value })
                      }
                      className="mt-1 w-full resize-y rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                    />
                  </div>

                  <div className="mt-3">
                    <label className="block text-xs text-ink-dim">
                      Constraints (comma separated)
                    </label>
                    <input
                      value={shot.constraints.join(', ')}
                      disabled={status === 'generating'}
                      onChange={(event) =>
                        void patchShot(shot.id, {
                          constraints: event.target.value.split(',').map((item) => item.trim()),
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                    />
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={status === 'generating' || saving}
                  onClick={addShot}
                  className="rounded-lg border border-line bg-panel px-4 py-2 text-sm text-ink hover:bg-panel-2 disabled:opacity-50"
                >
                  + Add shot
                </button>
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
              </div>
              <button
                type="button"
                disabled={status === 'generating' || saving || shots.length === 0}
                onClick={() => void approve()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Approve shot list & open editor'}
              </button>
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
            {workflow.shotList.revision > 0 && (
              <p className="text-xs text-ink-dim">Revision {workflow.shotList.revision}</p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
