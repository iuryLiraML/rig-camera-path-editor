// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
vi.mock('../lib/siteSession', () => ({ fetchSiteSession: vi.fn(async () => ({ email: null, loginConfigured: false })) }))
import { fetchSiteSession } from '../lib/siteSession'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { useEditorStore } from '../state/useEditorStore'
import { AccountMenu } from './AccountMenu'

afterEach(() => {
  cleanup()
  useCloudAuthStore.setState({
    status: 'signed-out',
    session: null,
    accessToken: null,
  })
  useEditorStore.setState({ showSettings: false })
})

describe('AccountMenu', () => {
  it('recognizes the site Google session independently of cloud sync', async () => {
    vi.mocked(fetchSiteSession).mockResolvedValueOnce({ email: 'tim@silverside.ai', loginConfigured: true })
    useCloudAuthStore.setState({ status: 'signed-out', session: null })
    const { getByTitle, getByText, queryByText } = render(<AccountMenu />)
    fireEvent.click(getByTitle('Account'))
    await waitFor(() => expect(getByText('tim@silverside.ai')).toBeTruthy())
    expect(getByText('Sign out')).toBeTruthy()
    expect(queryByText('Not signed in')).toBeNull()
    expect(useCloudAuthStore.getState().status).toBe('signed-out')
  })
  it('uses an avatar trigger without painting the Account label', () => {
    const { getByTitle, queryByText } = render(<AccountMenu />)
    expect(getByTitle('Account')).toBeTruthy()
    expect(queryByText('Account')).toBeNull()
  })

  it('offers Settings and Sign in when disconnected', () => {
    useCloudAuthStore.setState({ status: 'signed-out', session: null })
    const { getByTitle, getByText, queryByText } = render(<AccountMenu />)
    fireEvent.click(getByTitle('Account'))
    expect(getByText('Not signed in')).toBeTruthy()
    expect(getByText('Settings')).toBeTruthy()
    expect(getByText('Sign in')).toBeTruthy()
    expect(queryByText('Sign out')).toBeNull()
    fireEvent.click(getByText('Settings'))
    expect(useEditorStore.getState().showSettings).toBe(true)
  })

  it('shows identity and Sign out only with a cloud session', () => {
    useCloudAuthStore.setState({
      status: 'signed-in',
      session: {
        userId: 'sub-1',
        tenantId: 't',
        email: 'ada@lightfarm.test',
        name: 'Ada',
        picture: null,
      },
    })
    const { getByTitle, getByText, queryByText } = render(<AccountMenu />)
    expect(getByTitle('Account').textContent).not.toMatch(/ada@/i)
    fireEvent.click(getByTitle('Account'))
    expect(getByText('Ada')).toBeTruthy()
    expect(getByText('ada@lightfarm.test')).toBeTruthy()
    expect(getByText('Sign out')).toBeTruthy()
    expect(queryByText('Sign in')).toBeNull()
  })
})
