// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useEditorStore } from '../state/useEditorStore'

// the site-access section is the only thing under test; the provider section's
// model list would otherwise fire a network request on open
vi.mock('../lib/agent/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/agent/providers')>()),
  listProviderModels: vi.fn(async () => []),
}))

vi.mock('../lib/siteSession', () => ({ fetchSessionEmail: vi.fn() }))

import { fetchSessionEmail } from '../lib/siteSession'
import { SettingsDialog } from './SettingsDialog'

const mockedFetchSessionEmail = vi.mocked(fetchSessionEmail)

beforeEach(() => {
  useEditorStore.setState({ showSettings: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** The fetch resolves in an effect, so the section appears a microtask later. */
async function renderSettled() {
  const result = render(<SettingsDialog />)
  await act(async () => {})
  return result
}

describe('SettingsDialog — site access', () => {
  it('shows the signed-in email and a sign-out link', async () => {
    mockedFetchSessionEmail.mockResolvedValue('tim.meyer@silverside.ai')
    const { container } = await renderSettled()

    expect(container.textContent).toContain('Site access')
    expect(container.textContent).toContain('tim.meyer@silverside.ai')

    const link = container.querySelector<HTMLAnchorElement>('a[href="/api/auth/logout"]')
    // must be a real navigation, not a fetch() — the server sets the clearing
    // cookie and serves the signed-out page, which lives outside the gate
    expect(link).not.toBeNull()
    expect(link?.textContent).toBe('Sign out of Rig')
  })

  it('hides the whole section when there is no site session', async () => {
    mockedFetchSessionEmail.mockResolvedValue(null)
    const { container } = await renderSettled()

    expect(container.textContent).not.toContain('Site access')
    expect(container.querySelector('a[href="/api/auth/logout"]')).toBeNull()
  })

  it('does not offer the cloud-account "Sign out" wording, which is a different concept', async () => {
    mockedFetchSessionEmail.mockResolvedValue('tim.meyer@silverside.ai')
    const { container } = await renderSettled()
    const link = container.querySelector('a[href="/api/auth/logout"]')
    expect(link?.textContent).not.toBe('Sign out')
  })
})
