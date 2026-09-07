// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useEditorStore } from '../state/useEditorStore'
import { ModeSwitcher } from './ModeSwitcher'

afterEach(() => {
  cleanup()
  useEditorStore.setState({
    workspaceMode: 'build',
    showOutliner: false,
    directorPreference: 'expanded',
  })
})

describe('ModeSwitcher', () => {
  it('does not pin itself to the window centre', () => {
    useEditorStore.setState({ workspaceMode: 'build', showOutliner: true })
    const { container } = render(<ModeSwitcher />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).not.toMatch(/\bfixed\b/)
    expect(root.style.left).toBe('')
    expect(root.className).toMatch(/\bshrink-0\b/)
  })
})
