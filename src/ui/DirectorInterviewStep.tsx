import { useEffect, useRef, useState } from 'react'
import { runIntakeInterviewTurn } from '../lib/agent/runIntakeInterview'
import { PROVIDERS } from '../lib/agent/providers'
import {
  appendInterviewTurn,
  beginInterview,
  completeInterviewBrief,
  type ProjectWorkflow,
} from '../lib/projectWorkflow'
import { saveActiveProject } from '../lib/projects'
import { syncActiveProjectToCloud } from '../lib/cloud/sync'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'

const START_PROMPT =
  'Begin the director interview. Ask your first production question now.'

const SYNTHESIS_PROMPT =
  'Please synthesize the creative brief now based on our conversation.'

/** A turn that has not answered by now is treated as failed, not as pending. */
const TURN_TIMEOUT_MS = 90_000

export function DirectorInterviewStep() {
  const workflow = useProjectStore((state) => state.workflow)
  const provider = useAgentStore((state) => state.provider)
  const apiKey = useAgentStore((state) => state.keys[state.provider])
  const serverKey = useAgentStore((state) => state.serverKeys[state.provider])
  const model = useAgentStore((state) => state.models[state.provider])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'thinking'>('idle')
  const [error, setError] = useState<string | null>(null)
  /** text of the turn that failed, so it can be retried without retyping */
  const [lastFailedTurn, setLastFailedTurn] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const startedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** in-flight turn, so it can be cancelled or timed out instead of hanging */
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [workflow.interview.transcript, status])

  const persistWorkflow = async (next: ProjectWorkflow) => {
    const previous = useProjectStore.getState().workflow
    useProjectStore.getState().setWorkflow(next)
    try {
      await saveActiveProject()
      await syncActiveProjectToCloud().catch(() => undefined)
    } catch {
      useProjectStore.getState().setWorkflow(previous)
      throw new Error('Interview could not be saved.')
    }
  }

  /** Returns true when the turn completed, so callers only clear input on success. */
  const runTurn = async (userText: string, nextWorkflow?: ProjectWorkflow): Promise<boolean> => {
    const trimmedKey = apiKey.trim()
    if (!trimmedKey && !serverKey) {
      setError(`Add your ${PROVIDERS[provider].label} API key in Settings first.`)
      return false
    }

    setStatus('thinking')
    setError(null)
    setSaveError(null)

    let working = nextWorkflow ?? workflow
    if (working.interview.status === 'not-started') {
      working = beginInterview(working)
    }
    working = appendInterviewTurn(working, { role: 'client', text: userText })

    const controller = new AbortController()
    abortRef.current = controller
    // free the UI on timeout: a pending request used to disable every control
    // with no way out but reloading the page
    const timeout = window.setTimeout(() => {
      if (abortRef.current !== controller) return
      setError('The provider did not answer in time. Try again.')
      setLastFailedTurn(userText)
      abortRef.current = null
      setStatus('idle')
      controller.abort()
    }, TURN_TIMEOUT_MS)

    try {
      const result = await runIntakeInterviewTurn(
        working,
        { provider, apiKey: trimmedKey, model },
        controller.signal,
      )
      // a late answer to a cancelled/timed-out turn must not resurrect it
      if (controller.signal.aborted) return false
      working = appendInterviewTurn(working, { role: 'director', text: result.assistantText })

      if (result.creativeBrief) {
        working = completeInterviewBrief(working, result.creativeBrief)
      }

      await persistWorkflow(working)
      return true
    } catch (cause) {
      if (controller.signal.aborted) return false // already reported by cancel/timeout
      setError(cause instanceof Error ? cause.message : 'Interview request failed')
      setLastFailedTurn(userText)
      return false
    } finally {
      window.clearTimeout(timeout)
      if (abortRef.current === controller) {
        abortRef.current = null
        setStatus('idle')
      }
    }
  }

  /** Abandon the in-flight turn and hand the controls back immediately. */
  const cancelTurn = () => {
    const controller = abortRef.current
    if (!controller) return
    abortRef.current = null
    setStatus('idle')
    setError('Turn cancelled.')
    controller.abort()
  }

  useEffect(() => {
    if (startedRef.current) return
    if (workflow.interview.transcript.length > 0) return
    startedRef.current = true
    void runTurn(START_PROMPT)
  }, [workflow.interview.transcript.length])

  const sendAnswer = async () => {
    const text = input.trim()
    if (!text || status === 'thinking') return
    // Clear only after the turn lands: on failure the answer stayed nowhere —
    // not in the box, not in the transcript — and was unrecoverable.
    if (await runTurn(text)) setInput('')
  }

  /** Re-run the turn that failed (covers the auto-started first question too). */
  const retryLastTurn = async () => {
    if (status === 'thinking' || !lastFailedTurn) return
    const text = lastFailedTurn
    setLastFailedTurn(null)
    if (!(await runTurn(text)) ) setLastFailedTurn(text)
  }

  const synthesizeBrief = async () => {
    if (status === 'thinking') return
    await runTurn(SYNTHESIS_PROMPT)
  }

  const saveDraft = async () => {
    setSaveError(null)
    try {
      await saveActiveProject()
    } catch {
      setSaveError('Draft could not be saved locally.')
    }
  }

  const hasKey = apiKey.trim().length > 0 || serverKey

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10 sm:px-10 lg:py-12">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
              Project setup · Step 3
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">
              Director interview
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-dim">
              One question at a time. The director uses your client brief and foundation facts to
              clarify style, prohibited moves, pacing, and delivery constraints.
            </p>
          </div>
          <span className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-dim">
            {workflow.interview.transcript.length} turns
          </span>
        </div>

        {!hasKey ? (
          <div className="mt-10 rounded-xl border border-line bg-panel p-6 text-center">
            <p className="text-sm text-ink-dim">
              The interview runs through your configured AI provider. Add an API key first.
            </p>
            <button
              type="button"
              onClick={() => useEditorStore.getState().setShowSettings(true)}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              Open Settings
            </button>
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="mt-8 min-h-[280px] flex-1 space-y-4 overflow-y-auto rounded-xl border border-line bg-panel p-4"
            >
              {workflow.interview.transcript.length === 0 && status === 'thinking' && (
                <p className="text-sm text-ink-dim">Preparing the first question…</p>
              )}
              {workflow.interview.transcript.map((turn, index) => {
                if (turn.role === 'client' && turn.text === START_PROMPT) return null
                return (
                <div
                  key={`${turn.at}-${index}`}
                  className={turn.role === 'client' ? 'flex justify-end' : ''}
                >
                  <div
                    className={
                      turn.role === 'client'
                        ? 'max-w-[85%] rounded-lg rounded-br-sm bg-accent px-3 py-2 text-sm leading-relaxed text-white'
                        : 'max-w-[90%] text-sm leading-relaxed text-ink'
                    }
                  >
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-dim">
                      {turn.role === 'client' ? 'You' : 'Director'}
                    </p>
                    <p className="whitespace-pre-wrap">{turn.text}</p>
                  </div>
                </div>
                )
              })}
              {status === 'thinking' && workflow.interview.transcript.length > 0 && (
                <p className="text-sm text-ink-dim">Director is thinking…</p>
              )}
            </div>

            {error && (
              <div role="alert" className="mt-4 flex flex-wrap items-center gap-3">
                <p className="text-sm text-red-400">{error}</p>
                {lastFailedTurn && (
                  <button
                    type="button"
                    disabled={status === 'thinking'}
                    onClick={() => void retryLastTurn()}
                    className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs text-ink hover:bg-panel-3 disabled:opacity-50"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
              <textarea
                value={input}
                rows={3}
                disabled={status === 'thinking'}
                placeholder="Answer the director's question…"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void sendAnswer()
                  }
                }}
                className="w-full resize-y rounded-lg border border-line bg-panel px-3 py-2.5 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={status === 'thinking'}
                  onClick={() => void saveDraft()}
                  className="rounded-lg border border-line bg-panel px-4 py-2 text-sm text-ink hover:bg-panel-2 disabled:opacity-50"
                >
                  Save draft
                </button>
                <div className="flex flex-wrap gap-2">
                  {status === 'thinking' && (
                    <button
                      type="button"
                      onClick={cancelTurn}
                      className="rounded-lg border border-line bg-panel-2 px-4 py-2 text-sm text-ink hover:bg-panel-3"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={status === 'thinking' || workflow.interview.transcript.length < 2}
                    onClick={() => void synthesizeBrief()}
                    className="rounded-lg border border-line bg-panel-2 px-4 py-2 text-sm text-ink hover:bg-panel-3 disabled:opacity-50"
                  >
                    Finish & synthesize brief
                  </button>
                  <button
                    type="button"
                    disabled={status === 'thinking' || !input.trim()}
                    onClick={() => void sendAnswer()}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    Send answer
                  </button>
                </div>
              </div>
              {saveError && (
                <p role="alert" className="text-sm text-red-400">
                  {saveError}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
