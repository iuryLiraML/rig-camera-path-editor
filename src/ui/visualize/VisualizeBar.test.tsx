// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeEmptyRigSnapshot, useCameraOptionsStore } from '../../state/useCameraOptionsStore'
import { useEditorStore } from '../../state/useEditorStore'
import { useProjectStore, type Shot } from '../../state/useProjectStore'
import { VisualizeBar } from './VisualizeBar'

function fakeShot(partial: Pick<Shot, 'id' | 'name' | 'order'>): Shot {
  return {
    ...partial,
    duration: 3,
    thumbnail: null,
    format: { aspect: '16:9', res: 1080, custom: [1920, 1080] },
    rig: { ...makeEmptyRigSnapshot(), fov: 32 },
  }
}

beforeEach(() => {
  useEditorStore.setState({
    workspaceMode: 'visualize',
    playMode: false,
    activeShotId: 'shot-a',
    viewMode: 'clay',
    depthRangeAuto: true,
    depthNear: 0.1,
    depthFar: 20,
    exportAspect: '16:9',
    exportRes: 1080,
    exportPasses: ['clay'],
  })
  useProjectStore.setState({
    shots: [
      fakeShot({ id: 'shot-a', name: 'Orbit', order: 0 }),
      fakeShot({ id: 'shot-b', name: 'Dive', order: 1 }),
    ],
  })
})

afterEach(() => {
  cleanup()
  useEditorStore.setState({ workspaceMode: 'build', activeShotId: null, viewMode: 'clay' })
  useProjectStore.setState({ shots: [] })
})

describe('VisualizeBar', () => {
  it('reviews shots without Add a Shot or Play animatic', () => {
    const { container } = render(<VisualizeBar />)
    expect(container.querySelector('[data-visualize-bar]')).not.toBeNull()
    expect(container.textContent).toContain('Shots')
    expect(container.textContent).toContain('Cameras')
    expect(container.textContent).not.toContain('Add a Shot')
    expect(container.textContent).not.toContain('Play animatic')
  })

  it('applies a shot without creating a camera', () => {
    const created = vi.spyOn(useCameraOptionsStore.getState(), 'createOption')
    const { getByTitle } = render(<VisualizeBar />)
    fireEvent.click(getByTitle('Review Dive'))
    expect(created).not.toHaveBeenCalled()
    expect(useEditorStore.getState().activeShotId).toBe('shot-b')
    created.mockRestore()
  })

  it('groups look, range, format and export without repeating pass checkboxes', () => {
    const { container, getByText, getByLabelText, queryByText } = render(<VisualizeBar />)
    expect(getByText('Look')).toBeTruthy()
    expect(getByText('Range')).toBeTruthy()
    expect(getByText('Format')).toBeTruthy()
    expect(getByLabelText('Depth near')).toBeTruthy()
    expect(getByLabelText('Depth far')).toBeTruthy()
    expect(container.querySelector('[data-depth-range]')).not.toBeNull()
    expect(container.textContent).toContain('Export video')
    expect(queryByText('✓Clay')).toBeNull()
  })

  it('dragging a depth slider switches to Depth and writes the range', () => {
    const { getByLabelText } = render(<VisualizeBar />)
    fireEvent.change(getByLabelText('Depth near'), { target: { value: '2.5' } })
    expect(useEditorStore.getState().viewMode).toBe('depth')
    expect(useEditorStore.getState().depthNear).toBe(2.5)
    expect(useEditorStore.getState().depthRangeAuto).toBe(false)
  })

  it('shows an eye toggle in Outline to hide scene objects', () => {
    useEditorStore.setState({ viewMode: 'outline', showSceneObjects: true })
    const { getByTitle, queryByTitle, rerender } = render(<VisualizeBar />)
    expect(getByTitle('Hide scene objects')).toBeTruthy()
    fireEvent.click(getByTitle('Hide scene objects'))
    expect(useEditorStore.getState().showSceneObjects).toBe(false)
    useEditorStore.setState({ viewMode: 'clay' })
    rerender(<VisualizeBar />)
    expect(queryByTitle('Hide scene objects')).toBeNull()
  })
})
