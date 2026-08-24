// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useEditorStore } from '../../state/useEditorStore'
import { useProjectStore, type Shot } from '../../state/useProjectStore'
import { ShotStrip } from './ShotStrip'

function fakeShot(partial: Pick<Shot, 'id' | 'name' | 'duration' | 'order'>): Shot {
  return {
    ...partial,
    thumbnail: null,
    format: { aspect: '16:9', res: 1080, custom: [1920, 1080] },
    rig: {
      anchors: [],
      closed: false,
      drawPlaneY: 0,
      duration: partial.duration,
      smoothness: 0.5,
      rounding: 0,
      loop: false,
      lookAtMode: 'path-tangent',
      target: [0, 0, 0],
      roll: 0,
      fov: 35,
      progressKeys: [],
    },
  }
}

beforeEach(() => {
  useProjectStore.setState({ shots: [] })
  useEditorStore.setState({ activeShotId: null })
})

afterEach(() => {
  cleanup()
  useProjectStore.setState({ shots: [] })
  useEditorStore.setState({ activeShotId: null })
})

describe('ShotStrip', () => {
  it('labels the deck Shots and keeps Add a Shot / Play animatic on the strip', () => {
    const { container, getByText } = render(<ShotStrip />)
    expect(container.querySelector('[data-shot-strip]')).not.toBeNull()
    expect(container.textContent).toContain('Shots')
    expect(container.textContent).toContain('Add a Shot')
    expect(container.textContent).toContain('Play animatic')
    expect(container.textContent).toContain('No shots yet')
    expect((getByText('Play animatic') as HTMLButtonElement).disabled).toBe(true)
  })

  it('lists snapshot cards and highlights the active take', () => {
    useProjectStore.setState({
      shots: [
        fakeShot({ id: 'shot-a', name: 'Orbit', duration: 4, order: 0 }),
        fakeShot({ id: 'shot-b', name: 'Dive', duration: 2.5, order: 1 }),
      ],
    })
    useEditorStore.setState({ activeShotId: 'shot-b' })
    const { container, getByText } = render(<ShotStrip />)
    expect(getByText('Orbit')).toBeTruthy()
    expect(getByText('Dive')).toBeTruthy()
    expect(container.textContent).toContain('Shot 1')
    expect(container.textContent).toContain('Shot 2')
    expect(container.textContent).toContain('4.0s')
    expect(container.textContent).toContain('2.5s')
    const dive = getByText('Dive').closest('.group') as HTMLElement
    expect(dive.className).toContain('ring-accent')
  })

  it('deletes a shot from the card', () => {
    useProjectStore.setState({
      shots: [fakeShot({ id: 'shot-a', name: 'Orbit', duration: 4, order: 0 })],
    })
    useEditorStore.setState({ activeShotId: 'shot-a' })
    const { getByTitle } = render(<ShotStrip />)
    fireEvent.click(getByTitle('Delete shot'))
    expect(useProjectStore.getState().shots).toHaveLength(0)
    expect(useEditorStore.getState().activeShotId).toBeNull()
  })
})
