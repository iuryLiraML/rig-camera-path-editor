// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { NO_SERVER_KEYS } from '../lib/agent/serverKeys'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { OnboardingCard } from './OnboardingCard'

afterEach(() => {
  cleanup()
  useSceneStore.setState({ onboardingDismissed: false, objects: [] })
  useEditorStore.setState({ workspaceMode: 'build', playMode: false })
  useAgentStore.setState({ serverKeys: NO_SERVER_KEYS, keys: { anthropic: '', kimi: '' } })
})

describe('OnboardingCard Visualize', () => {
  it('does not send people to Settings when a site key is present', () => {
    useEditorStore.setState({ workspaceMode: 'visualize' })
    useAgentStore.setState({
      provider: 'anthropic',
      keys: { anthropic: '', kimi: '' },
      serverKeys: { anthropic: true, kimi: false, fal: false },
    })
    const { container, queryByText } = render(<OnboardingCard />)
    expect(queryByText('Open Settings')).toBeNull()
    expect(container.textContent).toContain('Type in the bar on the right')
  })

  it('points at Vercel env vars when this deployment has no site key', () => {
    useEditorStore.setState({ workspaceMode: 'visualize' })
    const { container, getByText } = render(<OnboardingCard />)
    expect(getByText('Open Settings')).toBeTruthy()
    expect(container.textContent).toContain('ANTHROPIC_API_KEY')
  })
})
