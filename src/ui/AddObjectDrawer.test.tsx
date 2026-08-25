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
  it('stays open without a close control', () => {
    const { queryByTitle } = render(<AddObjectDrawer />)
    expect(queryByTitle('Close')).toBeNull()
  })

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
    expect(container.textContent).toContain('Add your Fal API key in Settings')
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

describe('AddObjectDrawer primitive previews', () => {
  it('shows a distinct shape preview for every primitive, not a shared cube icon', () => {
    const { container } = render(<AddObjectDrawer />)
    const tiles = Array.from(container.querySelectorAll('[data-primitive]'))
    expect(tiles.map((tile) => tile.getAttribute('data-primitive'))).toEqual([
      'box',
      'sphere',
      'cylinder',
      'cone',
      'plane',
      'torus',
    ])
    const previews = tiles.map((tile) =>
      tile.querySelector('[data-primitive-preview]')?.getAttribute('data-primitive-preview'),
    )
    expect(previews).toEqual(['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus'])
    expect(container.querySelector('button[data-primitive] svg[viewBox="0 0 16 16"]')).toBeNull()
  })
})
