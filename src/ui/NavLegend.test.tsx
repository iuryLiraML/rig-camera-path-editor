// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useEditorStore } from '../state/useEditorStore'
import { NavLegend } from './NavLegend'
import { Toolbar } from './Toolbar'

afterEach(() => {
  cleanup()
})

describe('viewport home chrome', () => {
  it('lists the world-origin shortcut on the nav legend', () => {
    const { container } = render(<NavLegend />)
    expect(container.textContent).toContain('Origin · H')
  })

  it('offers a toolbar button that requests a home framing', () => {
    const before = useEditorStore.getState().homeRequest
    const { getByTitle } = render(<Toolbar />)
    fireEvent.click(getByTitle('Center the view on the world origin (H)'))
    expect(useEditorStore.getState().homeRequest).toBe(before + 1)
  })
})
