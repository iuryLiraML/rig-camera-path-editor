// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { LeftPanel } from './LeftPanel'
import { useEditorStore } from '../state/useEditorStore'
import { makeDefaultKnotObject, useSceneStore } from '../state/useSceneStore'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'

const selectedRow = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('div.group')).find(
    (row) => row.textContent?.includes(label) && row.className.includes('bg-accent'),
  )

describe('LeftPanel multi-selection', () => {
  beforeEach(() => {
    const first = makeDefaultKnotObject()
    first.id = 'first'
    first.name = 'First object'
    const second = makeDefaultKnotObject()
    second.id = 'second'
    second.name = 'Second object'
    useSceneStore.setState({ objects: [first, second] })
    usePathStore.setState({
      paths: [
        { id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 },
        { id: 'route', name: 'Route', anchors: [], closed: false, rounding: 0.8 },
      ],
      activePathId: CAMERA_PATH_ID,
    })
    useEditorStore.setState({ selection: null, selectionIds: [], hiddenIds: [] })
    useRigStore.setState({ cameraPathId: CAMERA_PATH_ID, cameraKind: 'path' })
  })

  afterEach(() => {
    cleanup()
    useSceneStore.setState({ objects: [] })
  })

  it('highlights every selected object and path row', () => {
    useEditorStore.getState().selectMany(['obj:first', 'obj:second', 'path:route'])
    const { container } = render(<LeftPanel />)

    expect(selectedRow(container, 'First object')).toBeTruthy()
    expect(selectedRow(container, 'Second object')).toBeTruthy()
    expect(selectedRow(container, 'Route')).toBeTruthy()
  })

  it('renames a path from a double-click in the Outliner', () => {
    const { getByText, getByLabelText } = render(<LeftPanel />)
    fireEvent.doubleClick(getByText('Route'))
    const input = getByLabelText('Rename Route') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Detour' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(usePathStore.getState().paths.find((p) => p.id === 'route')?.name).toBe('Detour')
  })

  it('Shift+click on a path row adds it without retargeting the followed camera', () => {
    const { getByText } = render(<LeftPanel />)
    fireEvent.click(getByText('Camera Path'))
    fireEvent.click(getByText('Route'), { shiftKey: true })
    expect(useEditorStore.getState().selectionIds).toEqual([
      `path:${CAMERA_PATH_ID}`,
      'path:route',
    ])
    expect(usePathStore.getState().activePathId).toBe('route')
    expect(useRigStore.getState().cameraPathId).toBe(CAMERA_PATH_ID)
  })

  it('Shift+click on a selected path row removes it without retargeting the followed camera', () => {
    const { getByText } = render(<LeftPanel />)
    fireEvent.click(getByText('Camera Path'))
    fireEvent.click(getByText('Route'), { shiftKey: true })
    fireEvent.click(getByText('Route'), { shiftKey: true })
    expect(useEditorStore.getState().selectionIds).toEqual([`path:${CAMERA_PATH_ID}`])
    expect(usePathStore.getState().activePathId).toBe(CAMERA_PATH_ID)
    expect(useRigStore.getState().cameraPathId).toBe(CAMERA_PATH_ID)
  })

  it('plain click on a path row replaces the selection without retargeting the followed camera', () => {
    useEditorStore.getState().selectMany(['obj:first', `path:${CAMERA_PATH_ID}`])
    const { getByText } = render(<LeftPanel />)
    fireEvent.click(getByText('Route'))
    expect(useEditorStore.getState().selectionIds).toEqual(['path:route'])
    expect(usePathStore.getState().activePathId).toBe('route')
    expect(useRigStore.getState().cameraPathId).toBe(CAMERA_PATH_ID)
  })

  it('Shift+click on an object row adds it without retargeting the followed camera', () => {
    const { getByText } = render(<LeftPanel />)
    fireEvent.click(getByText('First object'))
    fireEvent.click(getByText('Second object'), { shiftKey: true })
    expect(useEditorStore.getState().selectionIds).toEqual(['obj:first', 'obj:second'])
    expect(useRigStore.getState().cameraPathId).toBe(CAMERA_PATH_ID)
  })

  it('Shift+click on a selected object row removes it', () => {
    const { getByText } = render(<LeftPanel />)
    fireEvent.click(getByText('First object'))
    fireEvent.click(getByText('Second object'), { shiftKey: true })
    fireEvent.click(getByText('Second object'), { shiftKey: true })
    expect(useEditorStore.getState().selectionIds).toEqual(['obj:first'])
  })

  it('plain click on an object row replaces a mixed selection', () => {
    useEditorStore.getState().selectMany(['obj:first', `path:${CAMERA_PATH_ID}`])
    const { getByText } = render(<LeftPanel />)
    fireEvent.click(getByText('Second object'))
    expect(useEditorStore.getState().selectionIds).toEqual(['obj:second'])
    expect(useRigStore.getState().cameraPathId).toBe(CAMERA_PATH_ID)
  })
})
