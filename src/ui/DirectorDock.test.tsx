// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { NO_SERVER_KEYS } from '../lib/agent/serverKeys'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { DirectorDock } from './DirectorDock'

beforeEach(() => {
  useAgentStore.setState({
    chat: [],
    status: 'idle',
    error: null,
    failChips: [],
    serverKeys: NO_SERVER_KEYS,
  })
  useEditorStore.setState({
    workspaceMode: 'build',
    directorExpanded: false,
    playMode: false,
  })
})

afterEach(() => {
  cleanup()
  useEditorStore.setState({ workspaceMode: 'build', directorExpanded: false })
})

describe('DirectorDock', () => {
  it('shows the floating composer without a remaining-prompts line', () => {
    const { container } = render(<DirectorDock />)
    const textarea = container.querySelector('textarea')
    expect(textarea?.getAttribute('placeholder')).toBe('Describe a scene, watch AI build it in 3D')
    expect(container.textContent?.toLowerCase()).not.toContain('remaining')
    expect(container.textContent?.toLowerCase()).not.toContain('prompts remaining')
  })

  it('uses a Director prompt on Compose', () => {
    useEditorStore.setState({ workspaceMode: 'compose' })
    const { container } = render(<DirectorDock />)
    expect(container.querySelector('textarea')?.getAttribute('placeholder')).toBe(
      'Ask the Director to block a shot…',
    )
  })

  it('expands the transcript without adding a remaining-prompts line', () => {
    const { container, getByTitle } = render(<DirectorDock />)
    fireEvent.click(getByTitle('Expand chat'))
    expect(useEditorStore.getState().directorExpanded).toBe(true)
    expect(container.textContent).toContain('Director')
    expect(container.textContent?.toLowerCase()).not.toContain('remaining')
  })
})
