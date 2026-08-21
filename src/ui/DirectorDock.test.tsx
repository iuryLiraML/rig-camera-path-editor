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
    const root = container.firstElementChild as HTMLElement
    expect(root.style.top).toBeTruthy()
  })

  it('pins the composer to the right of the viewport, not the centre', () => {
    const { container } = render(<DirectorDock />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).not.toContain('-translate-x-1/2')
    expect(root.style.right).toBeTruthy()
    expect(root.style.left).toBe('')
    expect(Number.parseFloat(root.style.width)).toBeGreaterThan(0)
  })

  it('groups Add, Import and attach on the Build composer', () => {
    const { getByTitle, queryByTitle } = render(<DirectorDock />)
    expect(getByTitle('Add an object')).toBeTruthy()
    expect(getByTitle('Import a .glb or .gltf')).toBeTruthy()
    expect(getByTitle('Attach a reference photo')).toBeTruthy()
    expect(getByTitle('Send (Enter)')).toBeTruthy()
    expect(queryByTitle('Add an object')?.closest('.panel')).toBe(
      getByTitle('Import a .glb or .gltf').closest('.panel'),
    )
  })

  it('keeps Import on Compose without the Add control', () => {
    useEditorStore.setState({ workspaceMode: 'compose' })
    const { getByTitle, queryByTitle } = render(<DirectorDock />)
    expect(queryByTitle('Add an object')).toBeNull()
    expect(getByTitle('Import a .glb or .gltf')).toBeTruthy()
    expect(getByTitle('Attach a reference photo')).toBeTruthy()
  })

  it('docks the Compose composer into the timeline row', () => {
    useEditorStore.setState({ workspaceMode: 'compose' })
    const { container } = render(<DirectorDock />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.bottom).toBe('12px')
    expect(root.style.height).toBe('148px')
    expect(root.style.top).toBe('')
  })

  it('matches the Timeline dock height when that tab is selected', () => {
    useEditorStore.setState({ workspaceMode: 'compose', composeDock: 'timeline', timelineHeight: 240 })
    const { container } = render(<DirectorDock />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.bottom).toBe('12px')
    expect(root.style.height).toBe('240px')
  })

  it('grows the Compose transcript up the reserved column', () => {
    useEditorStore.setState({ workspaceMode: 'compose', directorExpanded: true })
    const { container } = render(<DirectorDock />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.bottom).toBe('12px')
    expect(root.style.top).toBeTruthy()
    expect(root.style.height).toBe('')
  })

  it('opens the import modal from the composer', () => {
    const { getByTitle } = render(<DirectorDock />)
    fireEvent.click(getByTitle('Import a .glb or .gltf'))
    expect(useEditorStore.getState().showImportModal).toBe(true)
  })
})
