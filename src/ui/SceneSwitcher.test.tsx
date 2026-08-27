// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useProjectStore } from '../state/useProjectStore'

vi.mock('../lib/projects', () => ({
  createScene: vi.fn(),
  renameScene: vi.fn(),
  switchScene: vi.fn(),
}))

import { createScene, switchScene } from '../lib/projects'
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
})

describe('SceneSwitcher', () => {
  it('lists scenes and switches away from the active one', () => {
    const { getByTitle, getByRole } = render(<SceneSwitcher />)
    fireEvent.click(getByTitle('Switch scene'))
    fireEvent.click(getByRole('menuitem', { name: 'Kitchen' }))
    expect(switchScene).toHaveBeenCalledWith('scene-2')
  })

  it('creates a new scene from the menu', () => {
    const { getByTitle, getByRole } = render(<SceneSwitcher />)
    fireEvent.click(getByTitle('Switch scene'))
    fireEvent.click(getByRole('menuitem', { name: '+ New scene' }))
    expect(createScene).toHaveBeenCalled()
  })
})
