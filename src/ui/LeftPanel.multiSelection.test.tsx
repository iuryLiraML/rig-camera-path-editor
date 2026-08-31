// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { LeftPanel } from './LeftPanel'
import { useEditorStore } from '../state/useEditorStore'
import { makeDefaultKnotObject, useSceneStore } from '../state/useSceneStore'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'

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
})
