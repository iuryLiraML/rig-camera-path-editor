// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { resetRemeshEtaForTests } from '../lib/remeshEta'
import { useSceneStore } from '../state/useSceneStore'
import { RemeshJobOverlay, RemeshProgressBar } from './RemeshProgressBar'

afterEach(() => {
  cleanup()
  resetRemeshEtaForTests()
  vi.restoreAllMocks()
  useSceneStore.setState({ pendingLifts: [], importing: 0 })
})

describe('RemeshJobOverlay', () => {
  it('centers a cancellable wait overlay for scene-block generate jobs', () => {
    useSceneStore.setState({
      pendingLifts: [
        { id: 'lift-1', name: 'Remeshing Person…', kind: 'generate', progress: 0.4, startedAt: 1 },
      ],
    })
    const { container } = render(<RemeshJobOverlay />)
    expect(container.textContent).toContain('Remeshing Person…')
    expect(container.textContent).toContain('Dense meshes remesh off-scene')
    expect(container.textContent).toContain('Cancel')
  })

  it('does not describe palco generate as a remesh', () => {
    useSceneStore.setState({
      pendingLifts: [
        {
          id: 'lift-env',
          name: 'Generating environment…',
          kind: 'generate',
          progress: null,
          startedAt: 1,
        },
      ],
    })
    const { container } = render(<RemeshJobOverlay />)
    expect(container.textContent).toContain('Generating environment…')
    expect(container.textContent).toContain('TripoSplat is building the palco')
    expect(container.textContent).not.toContain('Meshes remesh')
  })

  it('shows a time-based remesh bar against the typical wait', () => {
    const now = 1_700_000_030_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    useSceneStore.setState({
      pendingLifts: [
        {
          id: 'lift-boat',
          name: 'Boat — Remeshing…',
          kind: 'remesh',
          objectId: 'boat-1',
          progress: null,
          startedAt: now - 30_000,
        },
      ],
    })
    const { container } = render(<RemeshJobOverlay />)
    expect(container.textContent).toContain('Boat — Remeshing…')
    expect(container.textContent).toContain('1:00 left · typically 1:30')
    expect(container.textContent).toContain('Keep high mesh')
    const bar = container.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-valuenow')).toBe('33')
  })
})

describe('RemeshProgressBar', () => {
  it('prints remaining time on a determinate bar', () => {
    const { container } = render(
      <RemeshProgressBar progress={null} startedAt={1_000} now={31_000} />,
    )
    expect(container.textContent).toContain('1:00 left · typically 1:30')
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('33')
  })
})
