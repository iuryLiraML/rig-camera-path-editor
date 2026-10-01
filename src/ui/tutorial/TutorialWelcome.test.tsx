// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TutorialWelcome } from './TutorialWelcome'

afterEach(cleanup)

describe('TutorialWelcome', () => {
  it('shows the example before the explicit project-start action', () => {
    const onStart = vi.fn()
    const onClose = vi.fn()
    render(<TutorialWelcome onStart={onStart} onClose={onClose} />)

    expect(screen.getByRole('dialog', { name: 'Make your first camera move' })).toBeTruthy()
    expect(screen.getByRole('img', { name: /camera move entering a room/i })).toBeTruthy()
    expect(screen.getByText('Blank project')).toBeTruthy()
    expect(screen.getByText('AI-assisted project')).toBeTruthy()
    expect(onStart).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Start lesson' }))
    expect(onStart).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('can close the preview without starting a project', () => {
    const onStart = vi.fn()
    const onClose = vi.fn()
    render(<TutorialWelcome onStart={onStart} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onStart).not.toHaveBeenCalled()
  })
})
