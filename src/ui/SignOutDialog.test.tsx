// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useCloudAuthStore } from '../state/useCloudAuthStore'
import { SignOutDialog } from './SignOutDialog'

vi.mock('../lib/projects', () => ({
  uploadUnsyncedProject: vi.fn(async () => undefined),
  discardUnsyncedProject: vi.fn(async () => undefined),
  backupUnsyncedProject: vi.fn(async () => undefined),
}))

afterEach(() => {
  cleanup()
  useCloudAuthStore.setState({ pendingSignOut: null })
})

describe('SignOutDialog', () => {
  it('lists Upload now, Download JSON, and Discard on each unsynced project', () => {
    useCloudAuthStore.setState({
      pendingSignOut: [
        { id: 'proj-a', name: 'Alpha' },
        { id: 'proj-b', name: 'Beta' },
      ],
    })
    const { getByText, getAllByText } = render(<SignOutDialog />)
    expect(getByText('Alpha')).toBeTruthy()
    expect(getByText('Beta')).toBeTruthy()
    expect(getAllByText('Upload now')).toHaveLength(2)
    expect(getAllByText('Download JSON')).toHaveLength(2)
    expect(getAllByText('Discard')).toHaveLength(2)
  })
})
