// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'

vi.mock('../lib/agent/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/agent/providers')>()),
  listProviderModels: vi.fn(async () => [{ id: 'claude-opus-4-6', label: 'Claude Opus 4.6' }]),
}))

vi.mock('../lib/siteSession', () => ({ fetchSessionEmail: vi.fn(async () => null) }))

import { SettingsDialog } from './SettingsDialog'

beforeEach(() => {
  useEditorStore.setState({ showSettings: true })
  useAgentStore.setState({ serverKeys: { anthropic: true, fal: false } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/**
 * The model list sits behind a 350ms debounce in the dialog's effect, so a
 * bare `act` flush renders before the options arrive.
 */
async function renderSettled() {
  const result = render(<SettingsDialog />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450))
  })
  return result
}

describe('SettingsDialog — Director model', () => {
  it('exposes no Anthropic key input — the only key box left is Fal BYOK', async () => {
    const { container } = await renderSettled()

    // a key box for the Director would mean a vendor credential is being held
    // in the browser again; Fal's own BYOK field is untouched by this change
    const keyInputs = [...container.querySelectorAll<HTMLInputElement>('input[type="password"]')]
    expect(keyInputs.map((input) => input.placeholder)).toEqual(['key-…'])
    expect(container.textContent).not.toContain('sk-ant-')
    expect(container.textContent).not.toContain('API key')
  })

  it('offers no provider choice — Kimi is gone', async () => {
    const { container } = await renderSettled()
    expect(container.textContent).not.toContain('Kimi')
    expect(container.textContent).not.toContain('Provider')
  })

  it('says the site key is in use and keeps the model picker working', async () => {
    const { container } = await renderSettled()
    expect(container.textContent).toContain("deployment's shared Anthropic key")

    const select = container.querySelector<HTMLSelectElement>('select')
    expect(select).not.toBeNull()
    expect(select?.disabled).toBe(false)
    expect([...(select?.options ?? [])].map((option) => option.value)).toContain('claude-opus-4-6')
  })

  it('warns and names the env var when the deployment has no Anthropic key', async () => {
    useAgentStore.setState({ serverKeys: { anthropic: false, fal: false } })
    const { container } = await renderSettled()

    expect(container.textContent).toContain('No Anthropic key is configured on this deployment')
    expect(container.textContent).toContain('ANTHROPIC_API_KEY')
    // still no Director key box: the fix is in Vercel, not in the UI
    expect(container.textContent).not.toContain('API key')

    const select = container.querySelector<HTMLSelectElement>('select')
    expect(select?.disabled).toBe(true)
    expect(select?.textContent).toContain('Models unavailable')
  })
})
