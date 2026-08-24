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
    showImportModal: false,
    showAddDrawer: false,
    composeDock: 'sequence',
    timelineHeight: 240,
  })
})

afterEach(() => {
  cleanup()
  useEditorStore.setState({
    workspaceMode: 'build',
    directorExpanded: false,
    showImportModal: false,
    showAddDrawer: false,
    composeDock: 'sequence',
    timelineHeight: 240,
  })
})

describe('DirectorDock', () => {
  it('shows the Build prompt without a remaining-prompts line', () => {
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

  it('always shows the transcript on the full-height rail', () => {
    const { container, queryByTitle } = render(<DirectorDock />)
    expect(container.textContent).toContain('Director')
    expect(container.textContent?.toLowerCase()).not.toContain('remaining')
    expect(queryByTitle('Expand chat')).toBeNull()
    expect(queryByTitle('Collapse chat')).toBeNull()
    const root = container.firstElementChild as HTMLElement
    expect(root.style.top).toBe('12px')
    expect(root.style.bottom).toBe('12px')
  })

  it('pins the composer to the right of the viewport, not the centre', () => {
    const { container } = render(<DirectorDock />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).not.toContain('-translate-x-1/2')
    expect(root.style.right).toBeTruthy()
    expect(root.style.left).toBe('')
    expect(Number.parseFloat(root.style.width)).toBeGreaterThan(0)
  })

  it('keeps Import and attach on the composer without an Add toggle', () => {
    const { getByTitle, queryByTitle } = render(<DirectorDock />)
    expect(queryByTitle('Add an object')).toBeNull()
    expect(getByTitle('Import a .glb or .gltf')).toBeTruthy()
    expect(getByTitle('Attach a reference photo')).toBeTruthy()
    expect(getByTitle('Send (Enter)')).toBeTruthy()
  })

  it('keeps Import on Compose without the Add control', () => {
    useEditorStore.setState({ workspaceMode: 'compose' })
    const { getByTitle, queryByTitle } = render(<DirectorDock />)
    expect(queryByTitle('Add an object')).toBeNull()
    expect(getByTitle('Import a .glb or .gltf')).toBeTruthy()
    expect(getByTitle('Attach a reference photo')).toBeTruthy()
  })

  it('fills the Compose right rail from the top gutter to the bottom', () => {
    useEditorStore.setState({ workspaceMode: 'compose' })
    const { container, queryByTitle } = render(<DirectorDock />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('panel')
    expect(root.style.top).toBe('12px')
    expect(root.style.bottom).toBe('12px')
    expect(root.style.height).toBe('')
    expect(container.querySelectorAll('.panel')).toHaveLength(1)
    expect(container.textContent).toContain('Director')
    expect(queryByTitle('Expand chat')).toBeNull()
    expect(queryByTitle('Collapse chat')).toBeNull()
  })

  it('uses the same full-height rail in Visualize', () => {
    useEditorStore.setState({ workspaceMode: 'visualize' })
    const { container, queryByTitle } = render(<DirectorDock />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.top).toBe('12px')
    expect(root.style.bottom).toBe('12px')
    expect(container.textContent).toContain('Visualize')
    expect(queryByTitle('Expand chat')).toBeNull()
    expect(container.querySelector('textarea')?.getAttribute('placeholder')).toBe(
      'Describe the shot to generate…',
    )
  })

  it('keeps the full-height rail when the Timeline tab is selected', () => {
    useEditorStore.setState({ workspaceMode: 'compose', composeDock: 'timeline', timelineHeight: 240 })
    const { container } = render(<DirectorDock />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.top).toBe('12px')
    expect(root.style.bottom).toBe('12px')
    expect(root.style.height).toBe('')
  })

  it('opens the import modal from the composer', () => {
    const { getByTitle } = render(<DirectorDock />)
    fireEvent.click(getByTitle('Import a .glb or .gltf'))
    expect(useEditorStore.getState().showImportModal).toBe(true)
  })
})
