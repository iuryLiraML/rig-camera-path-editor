// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useSaveStatusStore } from '../lib/saveStatus'
import { useEditorStore } from '../state/useEditorStore'
import { ProjectChip } from './ProjectChip'

afterEach(() => {
  cleanup()
  useEditorStore.setState({ workspaceMode: 'build', showOutliner: false })
  useSaveStatusStore.setState({ status: 'saved' })
})

describe('ProjectChip', () => {
  it('puts the outliner toggle next to Projects in Build', () => {
    useEditorStore.setState({ workspaceMode: 'build', showOutliner: false })
    const { getByTitle, getByText } = render(<ProjectChip />)
    expect(getByTitle('Outliner')).toBeTruthy()
    expect(getByText('Projects')).toBeTruthy()
    fireEvent.click(getByTitle('Outliner'))
    expect(useEditorStore.getState().showOutliner).toBe(true)
  })

  it('keeps the Outliner button on the left when the panel is open', () => {
    useEditorStore.setState({ workspaceMode: 'build', showOutliner: true })
    const { container, getByTitle } = render(<ProjectChip />)
    const chip = container.firstElementChild as HTMLElement
    expect(chip.style.left).toBe('12px')
    const firstButton = chip.querySelector('button')
    expect(firstButton).toBe(getByTitle('Outliner'))
  })

  it('hides the outliner toggle in Visualize', () => {
    useEditorStore.setState({ workspaceMode: 'visualize' })
    const { queryByTitle, getByText } = render(<ProjectChip />)
    expect(queryByTitle('Outliner')).toBeNull()
    expect(getByText('Projects')).toBeTruthy()
  })

  it('shows Saved, Saving… and Not saved next to the project name', () => {
    useSaveStatusStore.setState({ status: 'saved' })
    const { getByText, rerender } = render(<ProjectChip />)
    expect(getByText('Saved')).toBeTruthy()
    useSaveStatusStore.setState({ status: 'saving' })
    rerender(<ProjectChip />)
    expect(getByText('Saving…')).toBeTruthy()
    useSaveStatusStore.setState({ status: 'dirty' })
    rerender(<ProjectChip />)
    expect(getByText('Not saved')).toBeTruthy()
  })
})
