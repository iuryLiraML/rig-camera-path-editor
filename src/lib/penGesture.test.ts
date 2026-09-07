// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { useEditorStore } from '../state/useEditorStore'
import {
  PEN_CLOSE_LOOP_PX,
  PEN_CURVE_DRAG,
  pathGizmoStealsStroke,
  penClosesLoop,
  penStealsPointerButton,
  penStealsWheel,
  penToolShouldMount,
  shouldHandlePenInput,
  strokeCursor,
} from './penGesture'

afterEach(() => {
  useEditorStore.setState({
    cameraView: false,
    playMode: false,
    workspaceMode: 'compose',
    tool: 'select',
  })
  usePathStore.setState({
    paths: [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
    activePathId: CAMERA_PATH_ID,
  })
})

describe('pen viewport navigation', () => {
  it('does not steal the wheel while idle so pinch/scroll can still zoom', () => {
    expect(penStealsWheel(false)).toBe(false)
  })

  it('steals the wheel only while dragging a point to nudge altitude', () => {
    expect(penStealsWheel(true)).toBe(true)
  })

  it('steals only the left button; middle/right stay with orbit pan', () => {
    expect(penStealsPointerButton(0)).toBe(true)
    expect(penStealsPointerButton(1)).toBe(false)
    expect(penStealsPointerButton(2)).toBe(false)
  })
})

describe('shouldHandlePenInput', () => {
  it('is silent in look-through so fly keeps LMB and wheel', () => {
    useEditorStore.setState({ cameraView: false, playMode: false, workspaceMode: 'compose' })
    expect(shouldHandlePenInput()).toBe(true)
    useEditorStore.setState({ cameraView: true })
    expect(shouldHandlePenInput()).toBe(false)
    useEditorStore.setState({ cameraView: false, playMode: true })
    expect(shouldHandlePenInput()).toBe(false)
  })
})

describe('penToolShouldMount', () => {
  const compose = {
    tool: 'pen' as const,
    playMode: false,
    workspaceMode: 'compose' as const,
    staticCamera: false,
    tech: false,
    cameraView: false,
  }

  it('mounts in Compose on a path camera', () => {
    expect(penToolShouldMount(compose)).toBe(true)
  })

  it('does not mount in look-through — same gate Draw already has', () => {
    expect(penToolShouldMount({ ...compose, cameraView: true })).toBe(false)
  })

  it('does not mount in Build, look-through, play, or tech', () => {
    expect(penToolShouldMount({ ...compose, workspaceMode: 'build' })).toBe(false)
    expect(penToolShouldMount({ ...compose, playMode: true })).toBe(false)
    expect(penToolShouldMount({ ...compose, tech: true })).toBe(false)
  })

  it('mounts in Compose on a Free camera — first point starts follow', () => {
    expect(penToolShouldMount({ ...compose, staticCamera: true })).toBe(true)
  })
})

describe('strokeCursor', () => {
  const compose = {
    tool: 'pen' as const,
    playMode: false,
    workspaceMode: 'compose' as const,
    tech: false,
    cameraView: false,
  }

  /**
   * Picking the Pen changed nothing on screen: no cursor, and the ghost marker
   * only appears after a pointermove. An armed Pen and a dead one were
   * indistinguishable, which is why a broken build read as a broken tool.
   */
  it('arms a crosshair for Pen and Draw in Compose', () => {
    expect(strokeCursor(compose)).toBe('crosshair')
    expect(strokeCursor({ ...compose, tool: 'draw' })).toBe('crosshair')
  })

  it('stays default for Select, which drags gizmos instead of placing', () => {
    expect(strokeCursor({ ...compose, tool: 'select' })).toBeUndefined()
  })

  /** It must not promise a click the canvas would drop. */
  it('stays default wherever the stroke tool cannot place', () => {
    expect(strokeCursor({ ...compose, workspaceMode: 'build' })).toBeUndefined()
    expect(strokeCursor({ ...compose, playMode: true })).toBeUndefined()
    expect(strokeCursor({ ...compose, tech: true })).toBeUndefined()
    expect(strokeCursor({ ...compose, cameraView: true })).toBeUndefined()
  })

  /** The cursor and the mount gate read the same state, so they cannot disagree. */
  it('agrees with penToolShouldMount on every combination', () => {
    for (const playMode of [false, true]) {
      for (const tech of [false, true]) {
        for (const cameraView of [false, true]) {
          for (const workspaceMode of ['compose', 'build'] as const) {
            const input = { ...compose, playMode, tech, cameraView, workspaceMode }
            expect(strokeCursor(input) === 'crosshair').toBe(
              penToolShouldMount({ ...input, staticCamera: false }),
            )
          }
        }
      }
    }
  })
})

describe('pathGizmoStealsStroke', () => {
  it('lets Pen select existing controls while Draw owns its entire stroke', () => {
    expect(pathGizmoStealsStroke('pen')).toBe(true)
    expect(pathGizmoStealsStroke('draw')).toBe(false)
    expect(pathGizmoStealsStroke('select')).toBe(true)
  })
})

describe('penClosesLoop', () => {
  it('closes only with more than two anchors and a click on the first point', () => {
    const first = { x: 100, y: 80 }
    expect(penClosesLoop(100, 80, first, 3)).toBe(true)
    expect(penClosesLoop(100 + PEN_CLOSE_LOOP_PX, 80, first, 3)).toBe(true)
    expect(penClosesLoop(100 + PEN_CLOSE_LOOP_PX + 1, 80, first, 3)).toBe(false)
    expect(penClosesLoop(100, 80, first, 2)).toBe(false)
    expect(penClosesLoop(100, 80, null, 4)).toBe(false)
  })
})

describe('pen curve drag', () => {
  it('a drag longer than the threshold marks the new point as a manual curve', () => {
    const id = usePathStore.getState().addAnchor([0, 0, 0])
    expect(PEN_CURVE_DRAG).toBe(0.05)
    usePathStore.getState().setHandleOut(id, [1, 0, 0], true)
    const anchor = usePathStore.getState().getPath(CAMERA_PATH_ID)?.anchors[0]
    expect(anchor?.manual).toBe(true)
    expect(anchor?.handleOut[0]).toBe(1)
  })
})
