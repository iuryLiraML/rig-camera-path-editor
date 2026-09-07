// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useProjectStore } from '../state/useProjectStore'

vi.mock('../lib/projects', () => ({
  createScene: vi.fn(),
  renameScene: vi.fn(),
  switchScene: vi.fn(),
}))

import { createScene, renameScene, switchScene } from '../lib/projects'
import { SceneSwitcher } from './SceneSwitcher'

beforeEach(() => {
  useProjectStore.setState({
    sceneName: 'Scene 1',
    activeSceneId: 'scene-1',
    scenes: [
      { id: 'scene-1', name: 'Scene 1' },
      { id: 'scene-2', name: 'Kitchen' },
    ],
    projectBusy: false,
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SceneSwitcher', () => {
  it('lists scenes and switches away from the active one', () => {
    const { getByTitle, getByRole } = render(<SceneSwitcher />)
    fireEvent.click(getByTitle('Switch scene'))
    fireEvent.click(getByRole('menuitem', { name: 'Kitchen' }))
    expect(switchScene).toHaveBeenCalledWith('scene-2')
  })

  it('creates a new scene from the menu', () => {
    const { getByTitle, getByRole, getByText } = render(<SceneSwitcher />)
    fireEvent.click(getByTitle('Switch scene'))
    expect(getByText('Scenes')).toBeTruthy()
    fireEvent.click(getByRole('menuitem', { name: 'New scene' }))
    expect(createScene).toHaveBeenCalled()
  })

  it('renames the active scene on double-click in the chip', () => {
    const { getByTitle, getByDisplayValue } = render(<SceneSwitcher />)
    fireEvent.doubleClick(getByTitle('Switch scene'))
    const input = getByDisplayValue('Scene 1')
    fireEvent.change(input, { target: { value: 'Kitchen set' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(renameScene).toHaveBeenCalledWith('scene-1', 'Kitchen set')
  })

  it('renames a scene on double-click in the open menu', () => {
    const { getByTitle, getByRole, getByDisplayValue } = render(<SceneSwitcher />)
    fireEvent.click(getByTitle('Switch scene'))
    fireEvent.doubleClick(getByRole('menuitem', { name: 'Kitchen' }))
    const input = getByDisplayValue('Kitchen')
    fireEvent.change(input, { target: { value: 'Studio' } })
    fireEvent.blur(input)
    expect(renameScene).toHaveBeenCalledWith('scene-2', 'Studio')
    expect(switchScene).not.toHaveBeenCalled()
  })
})
