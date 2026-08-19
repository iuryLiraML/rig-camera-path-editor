// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { LeftPanel } from './LeftPanel'
import { Toolbar } from './Toolbar'
import { useEditorStore } from '../state/useEditorStore'
import { usePathStore } from '../state/usePathStore'
import { CAMERA_PATH_ID } from '../state/usePathStore'

afterEach(cleanup)

describe('add controls', () => {
  it('portals the toolbar add menu so overflow cannot clip shapes and import', () => {
    useEditorStore.setState({ workspaceMode: 'compose' })
    const { container } = render(<Toolbar />)
    const toolbar = container.firstElementChild as HTMLElement
    const trigger = container.querySelector('button[title="Add a shape, path, or import a model"]')
    expect(trigger).not.toBeNull()
    fireEvent.click(trigger!)

    const importItem = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Import .glb…',
    )
    expect(importItem).toBeTruthy()
    expect(toolbar.contains(importItem!)).toBe(false)

    const freeCam = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Free camera',
    )
    expect(freeCam).toBeTruthy()
  })

  it('offers add on Scene and Paths in the outliner', () => {
    const { container } = render(<LeftPanel />)
    expect(container.querySelector('button[title="Add a shape or import a model"]')).not.toBeNull()
    expect(container.querySelector('button[title="Add a path"]')).not.toBeNull()
  })

  it('the Paths plus creates a path and arms Pen', () => {
    usePathStore.setState({
      paths: [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
      activePathId: CAMERA_PATH_ID,
    })
    useEditorStore.setState({ tool: 'select', selection: null })
    const { container } = render(<LeftPanel />)
    fireEvent.click(container.querySelector('button[title="Add a path"]')!)
    expect(usePathStore.getState().paths.length).toBe(2)
    expect(useEditorStore.getState().tool).toBe('pen')
    expect(useEditorStore.getState().selection).toBe('camera-path')
  })
})
