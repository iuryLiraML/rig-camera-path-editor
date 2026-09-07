// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useSaveStatusStore } from '../lib/saveStatus'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { TOP_ROW_HEIGHT } from './viewportInsets'
import { ProjectChip } from './ProjectChip'

afterEach(() => {
  cleanup()
  useEditorStore.setState({
    appView: 'editor',
    workspaceMode: 'build',
    showOutliner: false,
  })
  useProjectStore.setState({
    projectId: '',
    name: 'Untitled',
    sceneName: '',
    activeSceneId: '',
    scenes: [],
  })
  useSaveStatusStore.setState({ status: 'saved' })
})

describe('ProjectChip', () => {
  it('labels an unpersisted blank session as Draft', () => {
    useProjectStore.setState({ projectId: '' })
    const { getByText, queryByText } = render(<ProjectChip />)
    expect(getByText('Draft')).toBeTruthy()
    expect(queryByText('Saved')).toBeNull()
  })
  it('puts the outliner toggle next to Projects in Build', () => {
    useEditorStore.setState({ workspaceMode: 'build', showOutliner: false })
    const { getByTitle, getByText } = render(<ProjectChip />)
    expect(getByTitle('Outliner')).toBeTruthy()
    expect(getByText('Projects')).toBeTruthy()
    fireEvent.click(getByTitle('Outliner'))
    expect(useEditorStore.getState().showOutliner).toBe(true)
  })

  it('keeps the project name readable in the outliner header when a scene is selected', () => {
    useEditorStore.setState({ workspaceMode: 'build', showOutliner: true })
    useProjectStore.setState({
      name: 'Untitled',
      sceneName: 'Scene 1',
      activeSceneId: 'scene-1',
      scenes: [{ id: 'scene-1', name: 'Scene 1' }],
    })
    const { getByTitle } = render(<ProjectChip variant="header" />)
    const name = getByTitle('Project name')
    expect(name.textContent).toBe('Untitled')
    expect(name.className).toMatch(/whitespace-nowrap/)
    expect(name.className).toMatch(/min-w-0/)
    expect(name.closest('[data-project-chip]')?.querySelector('[title="Switch scene"]')).toBeNull()
  })

  it('keeps the Outliner button on the left when used as the column header', () => {
    useEditorStore.setState({ workspaceMode: 'build', showOutliner: true })
    const { container, getByTitle } = render(<ProjectChip variant="header" />)
    const chip = container.firstElementChild as HTMLElement
    expect(chip.style.height).toBe(`${TOP_ROW_HEIGHT}px`)
    expect(chip.className).toMatch(/w-full/)
    expect(chip.className).not.toMatch(/\bpanel\b/)
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
    useProjectStore.setState({ projectId: 'persisted-project' })
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

  it('keeps an Account control next to Projects', () => {
    const { getByTitle } = render(<ProjectChip />)
    expect(getByTitle('Account')).toBeTruthy()
    expect(getByTitle('Back to projects')).toBeTruthy()
  })

  it('caps at max-content when the outliner is closed', () => {
    useEditorStore.setState({ showOutliner: false })
    const { container, getByTitle, getByText, queryByText } = render(<ProjectChip />)
    const chip = container.firstElementChild as HTMLElement
    expect(chip.className).toMatch(/\bpanel\b/)
    expect(chip.style.width).toBe('max-content')
    expect(getByText('Projects')).toBeTruthy()
    expect(queryByText('Account')).toBeNull()
    expect(getByTitle('Account').className).toMatch(/shrink-0/)
    const name = getByTitle('Project name')
    expect(name.className).toMatch(/max-w-\[8rem\]/)
    expect(name.className).toMatch(/truncate/)
  })

  it('renames the project on double-click', () => {
    const { getByTitle, getByDisplayValue } = render(<ProjectChip />)
    fireEvent.doubleClick(getByTitle('Project name'))
    const input = getByDisplayValue('Untitled')
    fireEvent.change(input, { target: { value: 'Lookbook' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useProjectStore.getState().name).toBe('Lookbook')
  })

  it('matches the outliner column after a Projects round-trip', () => {
    useEditorStore.setState({
      appView: 'editor',
      workspaceMode: 'build',
      showOutliner: true,
    })
    useProjectStore.setState({ projectId: 'persisted-project' })
    useSaveStatusStore.setState({ status: 'saved' })
    useProjectStore.setState({
      name: 'Lookbook',
      sceneName: 'New scene',
      activeSceneId: 'scene-1',
      scenes: [{ id: 'scene-1', name: 'New scene' }],
    })

    const { container, getByText, getByTitle, queryByTitle, rerender } = render(
      <ProjectChip variant="header" />,
    )
    const assertReadableChip = () => {
      const chip = container.firstElementChild as HTMLElement
      expect(chip.className).toMatch(/w-full/)
      expect(chip.className).not.toMatch(/\bpanel\b/)
      expect(getByText('Projects')).toBeTruthy()
      expect(getByTitle('Project name').textContent).toBe('Lookbook')
      expect(getByTitle('Project name').className).toMatch(/whitespace-nowrap/)
      expect(queryByTitle('Switch scene')).toBeNull()
      expect(getByText('Saved')).toBeTruthy()
      expect(getByTitle('Account')).toBeTruthy()
      expect(queryByTitle('Close outliner')).toBeNull()
      expect(queryByTitle('Project menu')).toBeNull()
    }

    assertReadableChip()
    useEditorStore.getState().setAppView('projects')
    useEditorStore.getState().setAppView('editor')
    expect(useEditorStore.getState().showOutliner).toBe(true)
    rerender(<ProjectChip variant="header" />)
    assertReadableChip()
    fireEvent.click(getByTitle('Outliner'))
    expect(useEditorStore.getState().showOutliner).toBe(false)
  })
})
