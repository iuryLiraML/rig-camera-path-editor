// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useEditorStore } from '../state/useEditorStore'
import { Toolbar } from './Toolbar'

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
  useEditorStore.setState({
    workspaceMode: 'compose',
    tool: 'select',
    playMode: false,
    showOutliner: false,
    composeDock: 'timeline',
    timelineHeight: 168,
    directorPreference: 'auto',
  })
})

afterEach(() => {
  cleanup()
})

describe('Toolbar compact More', () => {
  it('keeps Pen and Draw reachable from More when they are not on the main row', () => {
    const { queryByTitle, getByTitle } = render(<Toolbar />)
    expect(queryByTitle('Pen — click to place path points (P)')).toBeNull()
    fireEvent.click(getByTitle('More'))
    expect(getByTitle('Pen — click to place path points (P)')).toBeTruthy()
    expect(getByTitle('Draw — stroke a new camera path from the top view (D)')).toBeTruthy()
  })
})
