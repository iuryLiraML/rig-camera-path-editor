// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useEditorStore } from '../state/useEditorStore'
import { NavLegend } from './NavLegend'
import { Toolbar } from './Toolbar'

afterEach(() => {
  cleanup()
  useEditorStore.setState({ workspaceMode: 'build' })
})

describe('viewport home chrome', () => {
  it('lists the world-origin shortcut on the nav legend', () => {
    const { container } = render(<NavLegend />)
    expect(container.textContent).toContain('Origin · H')
    expect(container.textContent).toContain('? shortcuts')
  })

  it('keeps the Compose legend to orbit chrome, not the full shortcut sheet', () => {
    useEditorStore.setState({ workspaceMode: 'compose' })
    const { container } = render(<NavLegend />)
    expect(container.textContent).toContain('Orbit · LMB')
    expect(container.textContent).toContain('? shortcuts')
    expect(container.textContent).not.toContain('Open Timeline')
    expect(container.textContent).not.toContain('Key the focused property')
    const root = container.firstElementChild as HTMLElement
    expect(root.style.width).toBe('')
    expect(Number.parseFloat(root.style.maxWidth)).toBeGreaterThan(0)
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
    expect(useEditorStore.getState().composeDock).toBe('timeline')
  })
})
