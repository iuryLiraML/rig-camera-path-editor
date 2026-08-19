import { afterEach, describe, expect, it } from 'vitest'
import { VIEWPORT_BG_DEFAULT_TOP } from '../viewport/viewportBackground'
import { useSceneStore } from '../state/useSceneStore'
import {
  historyClock,
  historyIsDirty,
  resetHistory,
  setHistoryClockForTests,
  undo,
} from './history'

afterEach(() => {
  useSceneStore.setState({ bgColor: VIEWPORT_BG_DEFAULT_TOP })
  resetHistory()
  setHistoryClockForTests(0)
})

describe('history vs remesh undo', () => {
  it('treats an uncommitted transform as dirty so Ctrl+Z undoes the move first', () => {
    resetHistory()
    expect(historyIsDirty()).toBe(false)
    expect(historyClock()).toBe(0)
    const before = useSceneStore.getState().bgColor
    useSceneStore.setState({ bgColor: '#111111' })
    expect(historyIsDirty()).toBe(true)
    expect(undo()).toBe(true)
    expect(useSceneStore.getState().bgColor).toBe(before)
    expect(historyClock()).toBe(0)
  })
})
