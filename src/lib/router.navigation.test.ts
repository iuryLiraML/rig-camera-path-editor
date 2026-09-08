// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { useSceneStore } from '../state/useSceneStore'

vi.mock('./projects', () => ({
  switchProject: vi.fn(async (id: string) => { useProjectStore.setState({ projectId: id, activeSceneId: `scene-${id}` }) }),
  switchScene: vi.fn(async (id: string) => { useProjectStore.setState({ activeSceneId: id }) }),
  goToProjectsHome: vi.fn(async () => { useEditorStore.getState().setAppView('projects'); return true }),
  openBlankProjectSession: vi.fn(async () => { useProjectStore.setState({ projectId: '', activeSceneId: '' }) }),
}))
import { goToProjectsHome, openBlankProjectSession, switchProject } from './projects'
import { installRouter } from './router'

let dispose: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  useEditorStore.setState({ appView: 'editor', workspaceMode: 'build' })
  useProjectStore.setState({ projectId: 'A', activeSceneId: 'scene-A', projectBusy: false })
  window.history.replaceState(null, '', '/#/p/A/scene-A/build')
})
afterEach(() => { dispose?.(); vi.clearAllTimers(); vi.useRealTimers() })

async function navigate(hash: string) {
  window.history.replaceState(null, '', `/${hash}`)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  await vi.advanceTimersByTimeAsync(0)
}

it('uses the save-aware Projects transition for browser navigation', async () => {
  dispose = await installRouter()
  await navigate('#/projects')
  expect(goToProjectsHome).toHaveBeenCalledOnce()
  expect(useEditorStore.getState().appView).toBe('projects')
})

it('keeps the editor and restores its URL when Projects cannot save', async () => {
  vi.mocked(goToProjectsHome).mockResolvedValueOnce(false)
  dispose = await installRouter()
  await navigate('#/projects')
  expect(useEditorStore.getState().appView).toBe('editor')
  expect(window.location.hash).toBe('#/p/A/scene-A/build')
})

it('keeps the newest navigation when an older project load finishes late', async () => {
  let release!: () => void
  vi.mocked(switchProject).mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => { release = resolve })
    useProjectStore.setState({ projectId: 'B', activeSceneId: 'scene-B' })
  })
  dispose = await installRouter()
  await navigate('#/p/B/scene-B/compose')
  await navigate('#/projects')
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(useEditorStore.getState().appView).toBe('projects')
  expect(window.location.hash).toBe('#/projects')
})

it('restores a blank session through a save-aware transition', async () => {
  dispose = await installRouter()
  await navigate('#/build')
  expect(openBlankProjectSession).toHaveBeenCalledOnce()
  expect(useProjectStore.getState().projectId).toBe('')
  expect(window.location.hash).toBe('#/build')
})

it('accepts Back to the original URL while another project is still loading', async () => {
  let release!: () => void
  vi.mocked(switchProject).mockImplementationOnce(async (_id, signal) => {
    await new Promise<void>((resolve) => { release = resolve })
    if (!signal?.aborted) useProjectStore.setState({ projectId: 'B', activeSceneId: 'scene-B' })
  })
  dispose = await installRouter()
  await navigate('#/p/B/scene-B/compose')
  await navigate('#/p/A/scene-A/build')
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(useProjectStore.getState().projectId).toBe('A')
  expect(window.location.hash).toBe('#/p/A/scene-A/build')
})

it('does not change mode or write a URL after disposal during a load', async () => {
  let release!: () => void
  vi.mocked(switchProject).mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => { release = resolve })
    useProjectStore.setState({ projectId: 'B', activeSceneId: 'scene-B' })
  })
  dispose = await installRouter()
  await navigate('#/p/B/scene-B/compose')
  dispose()
  const replace = vi.spyOn(window.history, 'replaceState')
  release()
  await vi.advanceTimersByTimeAsync(0)
  expect(useEditorStore.getState().workspaceMode).toBe('build')
  expect(replace).not.toHaveBeenCalled()
  replace.mockRestore()
})

it('recovers from an initial load failure and still handles later navigation', async () => {
  window.history.replaceState(null, '', '/#/p/B/build')
  vi.mocked(switchProject).mockRejectedValueOnce(new Error('Offline'))
  dispose = await installRouter()
  expect(useSceneStore.getState().notice).toContain('Offline')
  await navigate('#/projects')
  expect(useEditorStore.getState().appView).toBe('projects')
})

it('does not record the intermediate stores of a busy project transition', async () => {
  dispose = await installRouter()
  useProjectStore.setState({ projectBusy: true, projectId: 'B' })
  await vi.advanceTimersByTimeAsync(100)
  expect(window.location.hash).toBe('#/p/A/scene-A/build')
  useProjectStore.setState({ projectBusy: false, activeSceneId: 'scene-B' })
  await vi.advanceTimersByTimeAsync(100)
  expect(window.location.hash).toBe('#/p/B/scene-B/build')
})
