// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useEditorStore } from '../state/useEditorStore'

const { teamApp } = vi.hoisted(() => ({ teamApp: { current: false } }))

vi.mock('../lib/cloud/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/cloud/client')>()
  return { ...actual, isTeamCloudApp: () => teamApp.current }
})

vi.mock('../lib/projects', () => ({
  goHome: vi.fn(async () => true),
  bootProjects: vi.fn(async () => undefined),
}))

import { WelcomeWorkspace } from './WelcomeWorkspace'
import { goHome } from '../lib/projects'

afterEach(() => {
  cleanup()
  teamApp.current = false
  useEditorStore.setState({ appView: 'home' })
  vi.mocked(goHome).mockClear()
})

describe('WelcomeWorkspace', () => {
  it('offers Skip on the public app and no email field', () => {
    teamApp.current = false
    const { getByRole, queryByLabelText, container } = render(<WelcomeWorkspace />)
    expect(getByRole('heading', { name: 'Welcome to Rig' })).toBeTruthy()
    expect(getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(getByRole('button', { name: 'Skip' })).toBeTruthy()
    expect(getByRole('link', { name: 'Terms of Service' }).getAttribute('href')).toBe('/legal/terms.html')
    expect(getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/legal/privacy.html')
    expect(queryByLabelText(/email/i)).toBeNull()
    expect(container.querySelector('input[type="password"]')).toBeNull()
  })

  it('hides Skip on the cloud app', () => {
    teamApp.current = true
    const { queryByRole, getByRole } = render(<WelcomeWorkspace />)
    expect(getByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(queryByRole('button', { name: 'Skip' })).toBeNull()
  })

  it('Skip always opens Home even from Library', () => {
    useEditorStore.setState({ appView: 'library' })
    const { getByRole } = render(<WelcomeWorkspace />)
    fireEvent.click(getByRole('button', { name: 'Skip' }))
    expect(goHome).toHaveBeenCalled()
  })
})
