// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Timeline } from './Timeline'
import { CAMERA_PATH_ID, makeAnchor, usePathStore } from '../state/usePathStore'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'

/**
 * Regression: the timeline crashed the whole editor.
 *
 * The track curves added four `useMemo` calls, but they sat *below* the early
 * return for the "No camera path yet" empty state. Mounting without a path ran
 * 60 hooks; once a path existed the same component ran 64, and React threw
 * "Rendered more hooks than during the previous render" — which unmounts the tree,
 * so the app went blank rather than showing a broken timeline.
 *
 * It survived the first round of checking because the path already existed when
 * the timeline first mounted, so the count never changed. The transition is the
 * bug, so the transition is the test.
 */

const setAnchors = (count: number) => {
  usePathStore.setState((state) => ({
    paths: state.paths.map((path) =>
      path.id === CAMERA_PATH_ID
        ? {
            ...path,
            anchors: Array.from({ length: count }, (_, i) => makeAnchor([i, 1, i])),
          }
        : path,
    ),
  }))
}

beforeEach(() => {
  useEditorStore.setState({
    playMode: false,
    panelTab: 'design',
    timelineEasing: false,
    timelineHeight: 168,
    timelineView: { start: 0, span: 1 },
    selectedKeyframe: null,
    timelineGraph: false,
    graphChannel: 'progress',
  })
  useRigStore.setState({ progressKeys: [], fovKeys: [], rollKeys: [] })
  setAnchors(0)
})

afterEach(() => {
  cleanup()
  setAnchors(0)
  useEditorStore.setState({
    timelineEasing: false,
    timelineHeight: 168,
    timelineView: { start: 0, span: 1 },
    selectedKeyframe: null,
    timelineGraph: false,
    graphChannel: 'progress',
  })
  useRigStore.setState({ progressKeys: [], fovKeys: [], rollKeys: [] })
})

describe('Timeline', () => {
  it('shows the empty state with no camera path', () => {
    const { container } = render(<Timeline />)
    expect(container.textContent).toContain('No camera path yet')
  })

  it('survives a path appearing after it mounted', () => {
    const { container, rerender } = render(<Timeline />)
    expect(container.textContent).toContain('No camera path yet')

    // this is what crashed: the empty state renders fewer hooks than the timeline
    setAnchors(3)
    expect(() => rerender(<Timeline />)).not.toThrow()
    expect(container.textContent).not.toContain('No camera path yet')
    expect(container.textContent).toContain('Save shot')
  })

  it('survives a path disappearing again', () => {
    setAnchors(3)
    const { container, rerender } = render(<Timeline />)
    expect(container.textContent).toContain('Save shot')

    setAnchors(0)
    expect(() => rerender(<Timeline />)).not.toThrow()
    expect(container.textContent).toContain('No camera path yet')
  })

  it('draws the camera curve once there is a path', () => {
    setAnchors(3)
    const { container } = render(<Timeline />)
    // the default-ease curve is drawn even with zero keyframes
    expect(container.querySelector('svg[viewBox="0 0 100 100"] polyline')).not.toBeNull()
  })

  it('hides interval handles until Easing is on', () => {
    setAnchors(3)
    const { container } = render(<Timeline />)
    expect(container.querySelector('[data-ease-handle]')).toBeNull()
    expect(container.textContent).toContain('Easing')
  })

  it('draws interval handles on the camera track when Easing is on', () => {
    setAnchors(3)
    useEditorStore.setState({ timelineEasing: true })
    const { container } = render(<Timeline />)
    // implicit 0 and 1 ends give one interval → two handles
    expect(container.querySelectorAll('[data-ease-handle]').length).toBe(2)
    expect(container.textContent).toContain('Link')
    expect(container.textContent).toContain('Reset')
  })

  it('exposes a top-edge resize handle, not an Expand button', () => {
    setAnchors(3)
    const { container } = render(<Timeline />)
    expect(container.textContent).not.toContain('Expand')
    expect(container.querySelector('[data-timeline-resize]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Resize timeline"]')).not.toBeNull()
    expect(container.querySelector('[data-time-navigator]')).not.toBeNull()
  })

  it('exposes the resize handle on the empty dock', () => {
    const { container } = render(<Timeline />)
    expect(container.querySelector('[data-timeline-resize]')).not.toBeNull()
  })

  it('crops track curves to the visible time window', () => {
    setAnchors(3)
    useEditorStore.setState({ timelineView: { start: 0.25, span: 0.5 } })
    const { container } = render(<Timeline />)
    expect(container.querySelector('svg[viewBox="25 0 50 100"] polyline')).not.toBeNull()
  })

  it('always lists FOV and Roll tracks before the first key', () => {
    setAnchors(3)
    const { container } = render(<Timeline />)
    expect(container.querySelector('[data-track="fov"]')).not.toBeNull()
    expect(container.querySelector('[data-track="roll"]')).not.toBeNull()
    expect(container.textContent).toContain('FOV')
    expect(container.textContent).toContain('Roll')
  })

  it('adds an FOV key on double-click in the empty lane', () => {
    setAnchors(3)
    const { container } = render(<Timeline />)
    const lane = container.querySelector('[data-track="fov"] [data-lane]')
    expect(lane).not.toBeNull()
    fireEvent.doubleClick(lane!)
    expect(useRigStore.getState().fovKeys.length).toBe(1)
  })

  it('adds a key from the + button at the playhead', () => {
    setAnchors(3)
    useRigStore.setState({ t: 0.3, fov: 50 })
    const { container } = render(<Timeline />)
    const add = container.querySelector('[data-track="fov"] [data-add-key]')
    expect(add).not.toBeNull()
    fireEvent.click(add!)
    const keys = useRigStore.getState().fovKeys
    expect(keys).toHaveLength(1)
    expect(keys[0].time).toBeCloseTo(0.3, 5)
    expect(keys[0].value).toBeCloseTo(50, 5)
  })

  it('zooms time on wheel over the dock and shows the frame count', () => {
    setAnchors(3)
    useRigStore.setState({ t: 0, duration: 6 })
    const { container } = render(<Timeline />)
    expect(container.textContent).toContain('180f')
    expect(container.textContent).toMatch(/0:00/)
    const dock = container.querySelector('[data-timeline-dock]')
    expect(dock).not.toBeNull()
    fireEvent.wheel(dock!, { deltaY: -120 })
    expect(useEditorStore.getState().timelineView.span).toBeLessThan(1)
  })

  it('labels individual frames on the ruler when zoomed in', () => {
    setAnchors(3)
    useEditorStore.setState({ timelineView: { start: 0, span: 8 / 180 } })
    const { container } = render(<Timeline />)
    const ruler = container.querySelector('[aria-label="Time ruler"]')
    expect(ruler?.textContent).toMatch(/0:0[12]/)
  })

  it('opens the Graph Editor from the Graph button', () => {
    setAnchors(3)
    const { container } = render(<Timeline />)
    expect(container.querySelector('[data-graph-editor]')).toBeNull()
    expect(container.querySelector('[data-track="fov"]')).not.toBeNull()
    const toggle = container.querySelector('[data-graph-toggle]')
    expect(toggle).not.toBeNull()
    expect(toggle?.textContent).toBe('Graph')
    fireEvent.click(toggle!)
    expect(container.querySelector('[data-graph-editor]')).not.toBeNull()
    expect(container.querySelector('[data-track="fov"]')).toBeNull()
    expect(container.querySelector('[data-graph-value-axis]')?.textContent).toMatch(/%/)
    expect(useEditorStore.getState().timelineGraph).toBe(true)
    expect(useEditorStore.getState().timelineHeight).toBeGreaterThanOrEqual(300)
  })

  it('lists camera channels in the graph and switches the value axis', () => {
    setAnchors(3)
    useEditorStore.setState({ timelineGraph: true, timelineHeight: 300 })
    const { container } = render(<Timeline />)
    expect(container.querySelector('[data-graph-channel="fov"]')).not.toBeNull()
    expect(container.querySelector('[data-graph-channel="roll"]')).not.toBeNull()
    fireEvent.click(container.querySelector('[data-graph-channel="fov"]')!)
    expect(useEditorStore.getState().graphChannel).toBe('fov')
    expect(container.querySelector('[data-graph-value-axis]')?.textContent).toMatch(/°/)
  })

  it('draws a cubic spline and shows tangent handles on the selected key', () => {
    setAnchors(3)
    useRigStore.setState({
      fovKeys: [
        { id: 'a', time: 0, value: 30 },
        { id: 'b', time: 1, value: 80 },
      ],
    })
    useEditorStore.setState({
      timelineGraph: true,
      timelineHeight: 300,
      graphChannel: 'fov',
      selectedKeyframe: { kind: 'rig', channel: 'fov', id: 'a' },
    })
    const { container } = render(<Timeline />)
    expect(container.querySelector('[data-graph-spline]')).not.toBeNull()
    expect(container.querySelector('path[data-graph-spline]')?.getAttribute('d')).toContain('C')
    expect(container.querySelector('[data-bezier-handle="1"]')).not.toBeNull()
  })
})
