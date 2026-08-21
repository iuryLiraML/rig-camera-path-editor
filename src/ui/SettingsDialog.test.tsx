// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { NO_SERVER_KEYS } from '../lib/agent/serverKeys'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { SettingsDialog } from './SettingsDialog'

afterEach(() => {
  cleanup()
  useEditorStore.setState({ showSettings: false })
  useAgentStore.setState({ serverKeys: NO_SERVER_KEYS })
})

describe('SettingsDialog deployment keys', () => {
  it('reports which Vercel site keys the current deployment can see', () => {
    useEditorStore.setState({ showSettings: true })
    useAgentStore.setState({ serverKeys: { anthropic: true, kimi: false, fal: true } })
    const { container } = render(<SettingsDialog />)
    expect(container.textContent).toContain('ANTHROPIC_API_KEY')
    expect(container.textContent).toContain('KIMI_API_KEY')
    expect(container.textContent).toContain('FAL_KEY')
    expect(container.textContent).toContain('on this deployment')
    expect(container.textContent).toContain('not set')
    expect(container.textContent).toContain('never as VITE_*')
  })
})
