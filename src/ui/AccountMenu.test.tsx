// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
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
