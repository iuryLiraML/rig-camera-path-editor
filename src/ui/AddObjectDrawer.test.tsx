// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { NO_SERVER_KEYS } from '../lib/agent/serverKeys'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { useSceneStore } from '../state/useSceneStore'
import { AddObjectDrawer } from './AddObjectDrawer'

beforeEach(() => {
  useAgentStore.setState({ falKey: '', serverKeys: NO_SERVER_KEYS })
  useEditorStore.setState({ showSettings: false, addDrawerChip: 'primitives' })
})

afterEach(() => {
  cleanup()
  useAgentStore.setState({ falKey: '', serverKeys: NO_SERVER_KEYS })
  useEnvironmentStore.setState({ findOpen: false, findPlaceMode: 'unplaced' })
  useSceneStore.setState({ pendingLifts: [] })
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

  it('offers SAM 3.0 Body, Object, and Align as separate Generate modes', () => {
    useAgentStore.setState({ falKey: 'test-key' })
    const { container, getByText } = render(<AddObjectDrawer />)
    fireEvent.click(getByText('Generate'))
    expect(container.textContent).toContain('3D Body')
    expect(container.textContent).toContain('3D Object')
    expect(container.textContent).toContain('3D Align')
    expect(container.textContent).toContain('Name the object')
    expect(container.textContent).not.toContain('Block scene')
    expect(container.textContent).not.toContain('SAM 3.1')
  })

  it('opens a still drop for 3D Body and a noun field for 3D Object', () => {
    useAgentStore.setState({ falKey: 'test-key' })
    const { container, getByText } = render(<AddObjectDrawer />)
    fireEvent.click(getByText('Generate'))
    fireEvent.click(getByText('3D Body'))
    expect(container.textContent).toContain('Generate body')
    expect(container.textContent).toContain('SAM 3.0 reconstructs a textured body')
    fireEvent.click(getByText('← Back'))
    fireEvent.click(getByText('3D Object'))
    expect(container.querySelector('input[placeholder="chair, lamp, guitar…"]')).not.toBeNull()
    expect(container.textContent).toContain('Generate object')
  })

  it('offers From views as a separate VGGT tile and asks for overlapping stills', () => {
    useAgentStore.setState({ falKey: 'test-key' })
    const { container, getByText } = render(<AddObjectDrawer />)
    fireEvent.click(getByText('Generate'))
    expect(container.textContent).toContain('From views')
    expect(container.textContent).toContain('VGGT-1B')
    expect(container.textContent).toContain('Cloud → Unplaced')
    fireEvent.click(getByText('From views'))
    expect(container.textContent).toContain('overlapping photos')
    expect(container.textContent).toContain('Reconstruct')
    expect(container.textContent).toContain('not the palco')
    expect(container.querySelector('input[multiple]')).not.toBeNull()
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
    expect(container.textContent).toContain('Location stays on the Environment chip')
    expect(container.textContent).not.toContain('Queue to Unplaced')
  })
})

describe('AddObjectDrawer primitive previews', () => {
  it('shows a distinct shape preview for every primitive, not a shared cube icon', () => {
    const { container } = render(<AddObjectDrawer />)
    const tiles = Array.from(container.querySelectorAll('[data-primitive]'))
    expect(tiles.map((tile) => tile.getAttribute('data-primitive'))).toEqual([
      'female',
      'male',
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
    expect(previews).toEqual(['female', 'male', 'box', 'sphere', 'cylinder', 'cone', 'plane', 'torus'])
    expect(container.querySelector('button[data-primitive] svg[viewBox="0 0 16 16"]')).toBeNull()
  })
})
