// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, fireEvent } from '@testing-library/react'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { PathSections } from './RightPanel'

describe('PathSections', () => {
  beforeEach(() => {
    usePathStore.setState({
      paths: [
        { id: CAMERA_PATH_ID, name: 'Hero road', anchors: [], closed: false, rounding: 0.8 },
      ],
      activePathId: CAMERA_PATH_ID,
      selectedAnchorId: null,
      selectedAnchorIds: [],
    })
  })

  afterEach(() => cleanup())

  it('titles the inspector with the Camera Path display name, not a hard-coded label', () => {
    const { getByText } = render(<PathSections />)
    expect(getByText('Hero road')).toBeTruthy()
  })

  it('exposes point controls first, including Auto values, handle visibility and mirroring', () => {
    const s = usePathStore.getState()
    s.setPath([[0, 0, 0], [3, 1, 0], [9, 0, 2]], false)
    const id = s.getPath(s.activePathId)!.anchors[1].id
    s.selectAnchor(id)
    const ui = render(<PathSections />)
    expect(ui.getByText('Point 2')).toBeTruthy()
    expect(ui.getByText('Handle In')).toBeTruthy()
    expect(ui.getByText('Handle Out')).toBeTruthy()
    fireEvent.click(ui.getByLabelText('Show all handles'))
    expect(usePathStore.getState().showAllHandles).toBe(true)
    fireEvent.click(ui.getByText('Free', { exact: true }))
    fireEvent.click(ui.getByLabelText('Mirror handle lengths'))
    expect(s.getPath(s.activePathId)!.anchors[1].mirrored).toBe(true)
    fireEvent.click(ui.getByLabelText('Mirror handle lengths'))
    expect(s.getPath(s.activePathId)!.anchors[1].mirrored).toBe(false)
    expect(s.getPath(s.activePathId)!.anchors[1].handleOutType).toBe('aligned')
    fireEvent.click(ui.getByText('Pull In'))
    expect(ui.getByRole('status').textContent).toContain('incoming')
  })
})
