// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { NO_SERVER_KEYS } from '../lib/agent/serverKeys'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { AddObjectDrawer } from './AddObjectDrawer'

beforeEach(() => {
  useAgentStore.setState({ falKey: '', serverKeys: NO_SERVER_KEYS })
  useEditorStore.setState({ showSettings: false, addDrawerChip: 'primitives' })
})

afterEach(() => {
  cleanup()
  useAgentStore.setState({ falKey: '', serverKeys: NO_SERVER_KEYS })
  useEnvironmentStore.setState({ findOpen: false, findPlaceMode: 'unplaced' })
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
    expect(chips).toContain('Environment')
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

  it('says generated props land in Unplaced', () => {
    useAgentStore.setState({ falKey: 'test-key' })
    const { container, getByText } = render(<AddObjectDrawer />)
    fireEvent.click(getByText('Generate'))
    expect(container.textContent).toContain('Lands in Unplaced')
    expect(container.textContent).toContain('Photo → Unplaced')
  })
})

describe('AddObjectDrawer environment chip', () => {
  it('offers photo generate and ply import', () => {
    const { container, getByText } = render(<AddObjectDrawer />)
    fireEvent.click(getByText('Environment'))
    expect(container.textContent).toContain('From photo')
    expect(container.textContent).toContain('TripoSplat')
    expect(container.textContent).toContain('.ply / .splat')
  })

  it('opens the Environment chip from the empty-palco CTA store action', () => {
    useEditorStore.getState().openAddDrawerChip('environment')
    const { container, getByText } = render(<AddObjectDrawer />)
    expect(getByText('Environment').className).toContain('bg-accent')
    expect(container.textContent).toContain('TripoSplat')
  })
})

describe('AddObjectDrawer find objects', () => {
  it('offers Detect objects beside Detect people', () => {
    useEnvironmentStore.setState({ findOpen: true, findPlaceMode: 'unplaced' })
    const { container } = render(<AddObjectDrawer />)
    expect(container.textContent).toContain('Detect people')
    expect(container.textContent).toContain('Detect objects')
  })

  it('offers Place in scene when blocking from chat', () => {
    useEnvironmentStore.setState({ findOpen: true, findPlaceMode: 'scene' })
    const { container } = render(<AddObjectDrawer />)
    expect(container.textContent).toContain('Block this scene')
    expect(container.textContent).toContain('Place in scene')
    expect(container.textContent).not.toContain('Queue to Unplaced')
  })
})

describe('AddObjectDrawer primitive previews', () => {
  it('shows a distinct shape preview for every primitive, not a shared cube icon', () => {
    const { container } = render(<AddObjectDrawer />)
    const tiles = Array.from(container.querySelectorAll('[data-primitive]'))
    expect(tiles.map((tile) => tile.getAttribute('data-primitive'))).toEqual([
      'dummy',
      'box',
      'sphere',
      'cylinder',
      'cone',
      'plane',
      'torus',
    ])
    const previews = tiles
      .map((tile) => tile.querySelector('[data-primitive-preview]')?.getAttribute('data-primitive-preview'))
      .filter((value): value is string => Boolean(value))
    expect(previews).toEqual(['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus'])
    expect(container.querySelector('button[data-primitive] svg[viewBox="0 0 16 16"]')).toBeNull()
  })
})
