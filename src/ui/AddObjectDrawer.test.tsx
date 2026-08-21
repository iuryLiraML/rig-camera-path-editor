// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { NO_SERVER_KEYS } from '../lib/agent/serverKeys'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { AddObjectDrawer } from './AddObjectDrawer'

beforeEach(() => {
  useAgentStore.setState({ falKey: '', serverKeys: NO_SERVER_KEYS })
  useEditorStore.setState({ showSettings: false })
})

afterEach(() => {
  cleanup()
  useAgentStore.setState({ falKey: '', serverKeys: NO_SERVER_KEYS })
})

describe('AddObjectDrawer generate chip', () => {
  it('shows Generate beside Primitives and My assets', () => {
    const { container } = render(<AddObjectDrawer />)
    const chips = Array.from(container.querySelectorAll('button')).map((button) => button.textContent)
    expect(chips).toContain('Primitives')
    expect(chips).toContain('My assets')
    expect(chips).toContain('Generate')
  })

  it('keeps From text / From image visible but disabled without a Fal key', () => {
    const { container, getByText } = render(<AddObjectDrawer />)
    fireEvent.click(getByText('Generate'))
    expect(container.textContent).toContain('Add FAL_KEY in Vercel Environment Variables')
    expect(container.textContent).toContain('From text')
    expect(container.textContent).toContain('From image')
    const fromText = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('From text'),
    )
    expect(fromText?.hasAttribute('disabled')).toBe(true)
  })

  it('opens the text prompt when a Fal key is present', () => {
    useAgentStore.setState({ falKey: 'test-key' })
    const { container, getByText } = render(<AddObjectDrawer />)
    fireEvent.click(getByText('Generate'))
    fireEvent.click(getByText('From text'))
    expect(container.querySelector('textarea')).not.toBeNull()
  })
})
