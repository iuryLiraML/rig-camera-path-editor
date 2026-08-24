// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { NavLegend } from './NavLegend'
import { Toolbar } from './Toolbar'
import { ViewportFooter } from './ViewportFooter'

afterEach(() => {
  cleanup()
  useEditorStore.setState({ workspaceMode: 'build', cameraView: false, showShortcuts: false })
  useRigStore.setState({ cameraKind: 'path' })
})

describe('viewport home chrome', () => {
  it('shows a help chip in Build, not the orbit shortcut dump', () => {
    const { container, getByTitle } = render(<NavLegend />)
    expect(container.textContent).not.toContain('Orbit · LMB')
    expect(container.textContent).not.toContain('Origin · H')
    expect(getByTitle('Keyboard shortcuts (?)').textContent).toBe('?')
  })

  it('does not mount a legend in Compose — help lives on the footer', () => {
    useEditorStore.setState({ workspaceMode: 'compose' })
    const { container } = render(<NavLegend />)
    expect(container.textContent).toBe('')
  })

  it('hides the Build chip while looking through', () => {
    useEditorStore.setState({ workspaceMode: 'build', cameraView: true })
    const { container } = render(<NavLegend />)
    expect(container.textContent).toBe('')
  })

  it('opens the shortcut overlay from the Compose footer help chip', () => {
    useEditorStore.setState({ workspaceMode: 'compose', cameraView: false })
    const { getByTitle } = render(<ViewportFooter />)
    fireEvent.click(getByTitle('Keyboard shortcuts (?)'))
    expect(useEditorStore.getState().showShortcuts).toBe(true)
  })

  it('offers a toolbar button that requests a home framing', () => {
    const before = useEditorStore.getState().homeRequest
    const { getByTitle } = render(<Toolbar />)
    fireEvent.click(getByTitle('Center the view on the world origin (H)'))
    expect(useEditorStore.getState().homeRequest).toBe(before + 1)
  })

  it('opens Compose Timeline from the clock button', () => {
    useEditorStore.setState({ workspaceMode: 'build', composeDock: 'sequence' })
    const { getByTitle } = render(<Toolbar />)
    fireEvent.click(getByTitle('Timeline (T)'))
    expect(useEditorStore.getState().workspaceMode).toBe('compose')
  })
})
