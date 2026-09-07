// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ProjectCard } from './ProjectCard'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const project = {
  id: 'proj-1',
  name: 'Lookbook',
  setupStatus: 'ready' as const,
  folderId: null,
  shotCount: 2,
  updatedAt: Date.now(),
  scenes: [
    { id: 'scene-1', name: 'Scene 1' },
    { id: 'scene-2', name: 'Scene 2' },
  ],
}

describe('ProjectCard', () => {
  it('opens the actions menu without opening the project', () => {
    const onOpen = vi.fn()
    const { getByTitle } = render(
      <ProjectCard
        project={project}
        active={false}
        busy={false}
        folders={[]}
        onOpen={onOpen}
        onOpenScene={vi.fn()}
        onMove={vi.fn()}
        onRename={vi.fn()}
        onRenameScene={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(getByTitle('Project actions'))
    expect(onOpen).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Delete')
    expect(document.body.textContent).toContain('Rename')
  })

  it('asks for a second click before deleting', () => {
    const onDelete = vi.fn()
    const { getByTitle } = render(
      <ProjectCard
        project={project}
        active={false}
        busy={false}
        folders={[]}
        onOpen={vi.fn()}
        onOpenScene={vi.fn()}
        onMove={vi.fn()}
        onRename={vi.fn()}
        onRenameScene={vi.fn()}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(getByTitle('Project actions'))
    const deleteBtn = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Delete',
    )
    expect(deleteBtn).toBeTruthy()
    fireEvent.click(deleteBtn!)
    expect(onDelete).not.toHaveBeenCalled()
    const confirm = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Click again to delete',
    )
    fireEvent.click(confirm!)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('renames the project on double-click of the title', () => {
    const onRename = vi.fn()
    const { getByTitle, getByDisplayValue } = render(
      <ProjectCard
        project={project}
        active={false}
        busy={false}
        folders={[]}
        onOpen={vi.fn()}
        onOpenScene={vi.fn()}
        onMove={vi.fn()}
        onRename={onRename}
        onRenameScene={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.doubleClick(getByTitle('Project name'))
    const input = getByDisplayValue('Lookbook')
    fireEvent.change(input, { target: { value: 'Hero' } })
    fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledWith('Hero')
  })

  it('renames a scene on double-click without opening it', () => {
    const onOpenScene = vi.fn()
    const onRenameScene = vi.fn()
    const { getByTitle, getByDisplayValue } = render(
      <ProjectCard
        project={project}
        active={false}
        busy={false}
        folders={[]}
        onOpen={vi.fn()}
        onOpenScene={onOpenScene}
        onMove={vi.fn()}
        onRename={vi.fn()}
        onRenameScene={onRenameScene}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.doubleClick(getByTitle('Switch scene'))
    const input = getByDisplayValue('Scene 1')
    fireEvent.change(input, { target: { value: 'Kitchen' } })
    fireEvent.blur(input)
    expect(onRenameScene).toHaveBeenCalledWith('scene-1', 'Kitchen')
    expect(onOpenScene).not.toHaveBeenCalled()
  })

  it('lists every scene in a dropdown and opens the one you pick', () => {
    vi.useFakeTimers()
    const onOpenScene = vi.fn()
    const { getByTitle, getByRole } = render(
      <ProjectCard
        project={project}
        active={false}
        busy={false}
        folders={[]}
        onOpen={vi.fn()}
        onOpenScene={onOpenScene}
        onMove={vi.fn()}
        onRename={vi.fn()}
        onRenameScene={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(getByTitle('Switch scene'))
    expect(getByRole('menuitem', { name: 'Scene 2' })).toBeTruthy()
    fireEvent.click(getByRole('menuitem', { name: 'Scene 2' }))
    expect(onOpenScene).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(onOpenScene).toHaveBeenCalledWith('scene-2')
    vi.useRealTimers()
  })
})
