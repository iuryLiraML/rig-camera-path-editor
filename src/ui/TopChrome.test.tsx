// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useEditorStore } from '../state/useEditorStore'
import { GUTTER } from './viewportInsets'
import { TopChrome } from './TopChrome'

afterEach(() => {
  cleanup()
  useEditorStore.setState({
    workspaceMode: 'build',
    showOutliner: false,
    directorPreference: 'expanded',
  })
})

describe('TopChrome', () => {
  /**
   * The chip and the modes share one edge-anchored group, so neither can drift
   * onto the other. Centring the modes on the free area is what used to paint
   * them under the toolbar once the Director claimed the right of the row.
   */
  it('keeps identity, modes and tools in one row anchored to the window edges', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1202 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    const { container, getByTitle, getByText } = render(<TopChrome />)

    const left = container.querySelector('[data-top-row-left]') as HTMLElement
    const tools = container.querySelector('[data-toolbar-slot]') as HTMLElement
    expect(left.style.left).toBe(`${GUTTER}px`)
    expect(left.style.top).toBe(`${GUTTER}px`)
    expect(tools.style.right).toBe(`${GUTTER}px`)
    expect(tools.style.top).toBe(`${GUTTER}px`)
    expect(left.querySelector('[data-project-chip-slot]')).toBeTruthy()
    expect(left.querySelector('[data-mode-switcher-slot]')).toBeTruthy()
    expect(getByText('Projects')).toBeTruthy()
    expect(getByTitle('Place objects in the scene')).toBeTruthy()
    expect(getByTitle('Select (V)')).toBeTruthy()
  })

  it('keeps the chip and the modes in place when the outliner opens', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1202 })
    useEditorStore.setState({ workspaceMode: 'build', showOutliner: false })
    const { container, rerender } = render(<TopChrome />)
    const closedLeft = (container.querySelector('[data-top-row-left]') as HTMLElement).style.left

    useEditorStore.setState({ showOutliner: true })
    rerender(<TopChrome />)
    const open = container.querySelector('[data-top-row-left]') as HTMLElement
    expect(open.style.left).toBe(closedLeft)
    expect(container.querySelector('[data-project-chip]')).toBeTruthy()
  })
})
