// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useEditorStore } from '../state/useEditorStore'
import { ProjectChip } from './ProjectChip'

afterEach(() => {
  cleanup()
  useEditorStore.setState({ workspaceMode: 'build', showOutliner: false })
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

  it('hides the outliner toggle in Visualize', () => {
    useEditorStore.setState({ workspaceMode: 'visualize' })
    const { queryByTitle, getByText } = render(<ProjectChip />)
    expect(queryByTitle('Outliner')).toBeNull()
    expect(getByText('Projects')).toBeTruthy()
  })
})
