// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { GUTTER, TOP_ROW_HEIGHT } from './viewportInsets'
import { LeftPanel } from './LeftPanel'

afterEach(() => {
  cleanup()
  useEditorStore.setState({ workspaceMode: 'build', showOutliner: false })
  useProjectStore.setState({
    name: 'Untitled',
    sceneName: '',
    activeSceneId: '',
    scenes: [],
  })
})

describe('project menu', () => {
  it('portals onto document.body so the outliner cannot clip labels', () => {
    useEditorStore.setState({ workspaceMode: 'build', showOutliner: true })
    const { container } = render(<LeftPanel />)
    const panel = container.firstElementChild as HTMLElement

    const trigger = container.querySelector('button[title="Project menu"]')
    expect(trigger).not.toBeNull()
    fireEvent.click(trigger!)

    const labels = ['New project', 'Reset scene', 'Delete project', 'Settings…']
    for (const label of labels) {
      const item = Array.from(document.body.querySelectorAll('button')).find(
        (button) => button.textContent === label,
      )
      expect(item, label).toBeTruthy()
      expect(panel.contains(item!), label).toBe(false)
    }
  })

  /**
   * Identity now lives in the global top row, not in this column's header. The
   * outliner used to carry the chip and start at the window gutter, which put it
   * in the same band as the modes and the toolbar and made both unclickable.
   */
  it('starts below the global top row and leaves identity to the top chrome', () => {
    const { container } = render(<LeftPanel />)
    const panel = container.firstElementChild as HTMLElement
    expect(panel.style.left).toBe(`${GUTTER}px`)
    expect(panel.style.top).toBe(`${GUTTER + TOP_ROW_HEIGHT + GUTTER}px`)
    expect(panel.querySelector('[data-project-chip]')).toBeNull()
  })

  it('keeps scene switching in the Scene section', () => {
    useEditorStore.setState({ workspaceMode: 'build', showOutliner: true })
    useProjectStore.setState({
      name: 'Untitled',
      sceneName: 'Scene 1',
      activeSceneId: 'scene-1',
      scenes: [{ id: 'scene-1', name: 'Scene 1' }],
    })
    const { getByTitle } = render(<LeftPanel />)
    expect(getByTitle('Switch scene').textContent).toContain('Scene 1')
  })
})
