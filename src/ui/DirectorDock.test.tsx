// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { NO_SERVER_KEYS } from '../lib/agent/serverKeys'
import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { makeObject, makePrimitive, useSceneStore } from '../state/useSceneStore'
import { DirectorDock } from './DirectorDock'
import { GUTTER, TOP_ROW_HEIGHT } from './viewportInsets'
import * as THREE from 'three'

/** The rail starts below the global top row, not at the window gutter. */
const RAIL_TOP = `${GUTTER + TOP_ROW_HEIGHT + GUTTER}px`

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
    selection: null,
  })
  useSceneStore.setState({ objects: [] })
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
    selection: null,
  })
  useSceneStore.setState({ objects: [] })
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
    const { container, getByTitle } = render(<DirectorDock />)
    expect(container.textContent).toContain('Director')
    expect(container.textContent?.toLowerCase()).not.toContain('remaining')
    expect(getByTitle('Collapse Director')).toBeTruthy()
    const root = container.firstElementChild as HTMLElement
    expect(root.style.top).toBe(RAIL_TOP)
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
    expect(getByTitle('Import a .glb, .gltf or .obj')).toBeTruthy()
    expect(getByTitle('Attach a reference photo')).toBeTruthy()
    expect(getByTitle('Send (Enter)')).toBeTruthy()
  })

  it('keeps Import on Compose without the Add control', () => {
    useEditorStore.setState({ workspaceMode: 'compose' })
    const { getByTitle, queryByTitle } = render(<DirectorDock />)
    expect(queryByTitle('Add an object')).toBeNull()
    expect(getByTitle('Import a .glb, .gltf or .obj')).toBeTruthy()
    expect(getByTitle('Attach a reference photo')).toBeTruthy()
  })

  it('fills the Compose right rail from the top gutter to the bottom', () => {
    useEditorStore.setState({ workspaceMode: 'compose' })
    const { container, queryByTitle, getByTitle } = render(<DirectorDock />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('panel')
    expect(root.style.top).toBe(RAIL_TOP)
    expect(root.style.bottom).toBe('12px')
    expect(root.style.height).toBe('')
    expect(container.querySelectorAll('.panel')).toHaveLength(1)
    expect(container.textContent).toContain('Director')
    expect(queryByTitle('Expand chat')).toBeNull()
    expect(getByTitle('Collapse Director')).toBeTruthy()
  })

  it('uses the same full-height rail in Visualize', () => {
    useEditorStore.setState({ workspaceMode: 'visualize' })
    const { container, queryByTitle } = render(<DirectorDock />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.top).toBe(RAIL_TOP)
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
    expect(root.style.top).toBe(RAIL_TOP)
    expect(root.style.bottom).toBe('12px')
    expect(root.style.height).toBe('')
  })

  it('opens the import modal from the composer', () => {
    const { getByTitle } = render(<DirectorDock />)
    fireEvent.click(getByTitle('Import a .glb, .gltf or .obj'))
    expect(useEditorStore.getState().showImportModal).toBe(true)
  })

  it('parks object Transform on the Director rail', () => {
    const object = makeObject('Car', new THREE.Group(), { id: 'car' })
    useSceneStore.setState({ objects: [object] })
    useEditorStore.setState({ selection: 'obj:car' })
    const { getByText } = render(<DirectorDock />)
    expect(getByText('Transform')).toBeTruthy()
  })

  it('shows Transform then Shape with clay color for a selected mesh', () => {
    const object = makeObject('Car', new THREE.Group(), {
      id: 'car',
      shade: 0.5,
      clayColor: '#2563eb',
    })
    useSceneStore.setState({ objects: [object] })
    useEditorStore.setState({ selection: 'obj:car' })
    const { getByText, getByLabelText, getByRole, queryByRole } = render(<DirectorDock />)
    const transform = getByText('Transform')
    const shape = getByText('Shape')
    expect(transform.compareDocumentPosition(shape) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(queryByRole('button', { name: 'Body' })).toBeNull()
    expect(queryByRole('button', { name: 'Extrude face' })).toBeNull()

    const color = getByLabelText('Clay color') as HTMLInputElement
    expect(color.type).toBe('color')
    expect(color.value).toBe('#2563eb')
    fireEvent.change(color, { target: { value: '#dc2626' } })
    expect(useSceneStore.getState().objects[0]?.clayColor).toBe('#dc2626')
    fireEvent.click(getByRole('button', { name: 'Reset gray' }))
    expect(useSceneStore.getState().objects[0]?.clayColor).toBe('#bcbcbc')
    expect(color.value).toBe('#bcbcbc')
  })

  it('shows Body, Face, and Edge for a selected primitive', () => {
    const object = makePrimitive('box', { id: 'box' })
    useSceneStore.setState({ objects: [object] })
    useEditorStore.setState({ selection: 'obj:box' })
    const { getByText, getByRole } = render(<DirectorDock />)
    expect(getByText('Transform')).toBeTruthy()
    expect(getByText('Shape')).toBeTruthy()
    expect(getByRole('button', { name: 'Body' })).toBeTruthy()
    expect(getByRole('button', { name: 'Face' })).toBeTruthy()
    expect(getByRole('button', { name: 'Edge' })).toBeTruthy()
  })

  it('does not show Shape when the environment is selected', () => {
    useEditorStore.setState({ selection: 'env' })
    const { queryByText } = render(<DirectorDock />)
    expect(queryByText('Shape')).toBeNull()
  })
})
