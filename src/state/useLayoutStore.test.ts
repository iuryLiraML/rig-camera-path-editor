import { beforeEach, describe, expect, it } from 'vitest'
import { detectPreset, leafList, useLayoutStore } from './useLayoutStore'

const views = () => leafList(useLayoutStore.getState().root).map((l) => l.view)
const ids = () => leafList(useLayoutStore.getState().root).map((l) => l.id)

describe('useLayoutStore', () => {
  beforeEach(() => useLayoutStore.getState().applyPreset('single'))

  it('always offers a way back to a single pane', () => {
    // the footer only had two "split" buttons: nothing could undo a split, and
    // the per-pane close button was the only join affordance
    useLayoutStore.getState().applyPreset('quad')
    expect(useLayoutStore.getState().paneCount()).toBe(4)
    useLayoutStore.getState().applyPreset('single')
    expect(useLayoutStore.getState().paneCount()).toBe(1)
    expect(views()).toEqual(['editor'])
  })

  it('gives every pane of a preset a different view', () => {
    // a new pane always defaulted to 'camera', so a quad showed the same camera
    // three times over
    useLayoutStore.getState().applyPreset('quad')
    expect(new Set(views()).size).toBe(4)
    expect(views()).toContain('editor')
  })

  it('picks an unused view when splitting by hand', () => {
    const s = () => useLayoutStore.getState()
    s().splitPane(s().activePaneId, 'v')
    s().splitPane(s().activePaneId, 'h')
    expect(new Set(views()).size).toBe(3)
  })

  it('reports the preset a layout matches, ignoring divider positions', () => {
    const s = () => useLayoutStore.getState()
    s().applyPreset('director')
    expect(detectPreset(s().root)).toBe('director')
    s().setSplitRatio('split-root', 0.3)
    expect(detectPreset(s().root)).toBe('director')
    s().splitPane(s().activePaneId, 'h')
    expect(detectPreset(s().root)).toBe('')
  })

  it('moves the interactive editor to another pane, swapping views', () => {
    const s = () => useLayoutStore.getState()
    s().applyPreset('director')
    const [first, second] = ids()
    expect(s().activePaneId).toBe(first)

    s().setActivePane(second)
    expect(s().activePaneId).toBe(second)
    // the pane that gave up the editor inherits what the new one was showing
    expect(leafList(s().root).find((l) => l.id === first)?.view).toBe('camera')
    expect(leafList(s().root).find((l) => l.id === second)?.view).toBe('editor')
  })

  it("treats picking 'Editor' in a pane's view menu as activating it", () => {
    const s = () => useLayoutStore.getState()
    s().applyPreset('director')
    const second = ids()[1]
    s().setPaneView(second, 'editor')
    expect(s().activePaneId).toBe(second)
  })

  it('never closes the interactive pane', () => {
    const s = () => useLayoutStore.getState()
    s().applyPreset('director')
    s().joinPane(s().activePaneId)
    expect(s().paneCount()).toBe(2)
  })
})
