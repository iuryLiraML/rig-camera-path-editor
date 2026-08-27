import { afterEach, describe, expect, it } from 'vitest'
import { VIEWPORT_BG_DEFAULT_TOP } from '../viewport/viewportBackground'
import { useSceneStore } from '../state/useSceneStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { IDENTITY_ENV_TRANSFORM } from './environment'
import {
  historyClock,
  historyIsDirty,
  resetHistory,
  setHistoryClockForTests,
  setHistorySuspended,
  undo,
} from './history'

afterEach(() => {
  useSceneStore.setState({ bgColor: VIEWPORT_BG_DEFAULT_TOP })
  useEnvironmentStore.setState({
    environmentId: null,
    environmentTransform: IDENTITY_ENV_TRANSFORM,
    sceneBindings: [],
  })
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

describe('history vs environment pose', () => {
  it('undoes a palco move', () => {
    resetHistory()
    useEnvironmentStore.setState({
      environmentId: 'beach',
      environmentTransform: {
        position: [2, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    })
    expect(historyIsDirty()).toBe(true)
    expect(undo()).toBe(true)
    expect(useEnvironmentStore.getState().environmentTransform.position).toEqual([0, 0, 0])
    expect(useEnvironmentStore.getState().environmentId).toBeNull()
  })
})

describe('history suspend', () => {
  it('groups edits into one undo step', () => {
    resetHistory()
    const before = useSceneStore.getState().bgColor
    setHistorySuspended(true)
    useSceneStore.setState({ bgColor: '#111111' })
    useSceneStore.setState({ bgColor: '#222222' })
    setHistorySuspended(false)
    expect(useSceneStore.getState().bgColor).toBe('#222222')
    expect(undo()).toBe(true)
    expect(useSceneStore.getState().bgColor).toBe(before)
  })
})
