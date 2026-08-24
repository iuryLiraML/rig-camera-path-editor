// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ProjectCard } from './ProjectCard'

afterEach(() => {
  cleanup()
})

const project = {
  id: 'proj-1',
  name: 'Lookbook',
  setupStatus: 'ready' as const,
  folderId: null,
  shotCount: 2,
  updatedAt: Date.now(),
  scenes: [
    { id: 'shot-1', name: 'Shot 1' },
    { id: 'shot-2', name: 'Shot 2' },
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
})
