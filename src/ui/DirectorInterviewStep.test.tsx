// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectorInterviewStep } from './DirectorInterviewStep'
import { appendInterviewTurn, beginInterview, createProjectWorkflow } from '../lib/projectWorkflow'
import { useAgentStore } from '../state/useAgentStore'
import { useProjectStore } from '../state/useProjectStore'

// The turn goes through the provider; fail it to exercise the error path.
const runTurn = vi.hoisted(() => vi.fn())
vi.mock('../lib/agent/runIntakeInterview', () => ({ runIntakeInterviewTurn: runTurn }))
// Persistence is irrelevant here and would touch IndexedDB.
vi.mock('../lib/projects', () => ({ saveActiveProject: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../lib/cloud/sync', () => ({
  syncActiveProjectToCloud: vi.fn().mockResolvedValue(undefined),
}))

/** An interview already in progress, so the auto-start effect stays out of the way. */
function seedInterview() {
  let workflow = createProjectWorkflow('Test project')
  workflow = beginInterview(workflow)
  workflow = appendInterviewTurn(workflow, { role: 'director', text: 'What is the product?' })
  useProjectStore.setState({ workflow })
  useAgentStore.setState({
    provider: 'anthropic',
    keys: { anthropic: 'sk-ant-test', kimi: '' },
    models: { anthropic: 'claude-sonnet-5', kimi: 'kimi-k3' },
  })
}

beforeEach(() => {
  // jsdom does not implement Element.scrollTo, which the transcript auto-scroll uses
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}
  runTurn.mockReset()
  seedInterview()
})

afterEach(cleanup)

describe('DirectorInterviewStep', () => {
  it('keeps the typed answer when the turn fails, so it can be retried', async () => {
    runTurn.mockRejectedValue(new Error('provider is down'))
    render(<DirectorInterviewStep />)

    const box = screen.getByPlaceholderText("Answer the director's question…")
    fireEvent.change(box, { target: { value: 'A slow orbit around the bottle.' } })
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }))

    // the failure must surface…
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent ?? '').toMatch(/provider is down/i),
    )

    // …and the answer must NOT be lost: it is either still in the box, or it was
    // committed to the transcript. Losing both makes the text unrecoverable.
    const stillInBox = (box as HTMLTextAreaElement).value.includes('slow orbit')
    const inTranscript = useProjectStore
      .getState()
      .workflow.interview.transcript.some((turn) => turn.text.includes('slow orbit'))
    expect(stillInBox || inTranscript).toBe(true)
  })

  it('can cancel a turn that never responds, instead of freezing the step', async () => {
    // a hung provider: the promise never settles
    runTurn.mockImplementation(() => new Promise(() => {}))
    render(<DirectorInterviewStep />)

    const box = screen.getByPlaceholderText("Answer the director's question…")
    fireEvent.change(box, { target: { value: 'Something slow.' } })
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }))

    // while in flight the user must have a way out…
    const cancel = await waitFor(() => screen.getByRole('button', { name: /^cancel$/i }))
    fireEvent.click(cancel)

    // …and cancelling must return the step to a usable state
    await waitFor(() =>
      expect((screen.getByPlaceholderText("Answer the director's question…") as HTMLTextAreaElement).disabled).toBe(false),
    )
  })

  it('clears the answer once the turn succeeds', async () => {
    runTurn.mockResolvedValue({ assistantText: 'Noted.', creativeBrief: null, messages: [] })
    render(<DirectorInterviewStep />)

    const box = screen.getByPlaceholderText("Answer the director's question…")
    fireEvent.change(box, { target: { value: 'Keep it under 10 seconds.' } })
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }))

    await waitFor(() =>
      expect(
        useProjectStore
          .getState()
          .workflow.interview.transcript.some((turn) => turn.text.includes('under 10 seconds')),
      ).toBe(true),
    )
    expect((box as HTMLTextAreaElement).value).toBe('')
  })
})
