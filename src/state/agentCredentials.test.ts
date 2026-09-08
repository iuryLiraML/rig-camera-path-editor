// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { useAgentStore } from './useAgentStore'

afterEach(() => { useAgentStore.getState().setFalKey(''); localStorage.clear() })

it('removes legacy Director credentials while retaining the selected Anthropic model and Fal key', async () => {
  localStorage.clear()
  localStorage.setItem('rig-agent-settings', JSON.stringify({ version: 5, state: {
    provider: 'kimi', keys: { anthropic: 'audit-anthropic', kimi: 'audit-kimi' },
    models: { anthropic: 'claude-selected', kimi: 'kimi-old' }, falKey: 'audit-fal',
  } }))
  await useAgentStore.persist.rehydrate()
  expect(useAgentStore.getState().provider).toBe('anthropic')
  expect(useAgentStore.getState().models).toEqual({ anthropic: 'claude-selected' })
  expect(useAgentStore.getState()).not.toHaveProperty('keys')
  const saved = JSON.parse(localStorage.getItem('rig-agent-settings')!)
  expect(saved.version).toBe(6)
  expect(saved.state).not.toHaveProperty('keys')
  expect(saved.state.falKey).toBe('audit-fal')
  expect(JSON.stringify(saved)).not.toContain('audit-anthropic')
  expect(JSON.stringify(saved)).not.toContain('audit-kimi')
})
