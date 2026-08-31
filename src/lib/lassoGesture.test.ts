import { describe, expect, it } from 'vitest'
import {
  captureLassoSelectionSnapshot,
  hasLassoDrag,
  resolveLassoGestureFinish,
  shouldArmLasso,
  shouldSuppressMissedClick,
  type LassoGateInput,
} from './lassoGesture'

const allowed: LassoGateInput = {
  button: 0,
  shiftKey: true,
  background: true,
  paneView: 'editor',
  activePane: true,
  tool: 'select',
  sceneEditing: true,
  cameraView: false,
}

describe('lasso gesture gate', () => {
  it('arms for Shift plus left-drag on active editor background', () => {
    expect(shouldArmLasso(allowed)).toBe(true)
  })

  it.each([
    ['object or anchor hit', { background: false }],
    ['non-editor pane', { paneView: 'front' as const }],
    ['inactive editor pane', { activePane: false }],
    ['camera view', { cameraView: true }],
    ['wrong tool', { tool: 'pen' as const }],
    ['wrong button', { button: 1 }],
    ['missing Shift', { shiftKey: false }],
    ['non-editing mode', { sceneEditing: false }],
  ])('does not arm for %s', (_label, patch) => {
    expect(shouldArmLasso({ ...allowed, ...patch })).toBe(false)
  })

  it('suppresses the missed-click clear after a completed lasso', () => {
    expect(shouldSuppressMissedClick(true)).toBe(true)
    expect(shouldSuppressMissedClick(false)).toBe(false)
  })

  it('recognizes a closed lasso even when its final point returns to the start', () => {
    expect(
      hasLassoDrag(
        [
          { x: 10, y: 10 },
          { x: 80, y: 10 },
          { x: 80, y: 80 },
          { x: 10, y: 10 },
        ],
        5,
      ),
    ).toBe(true)
    expect(
      hasLassoDrag(
        [
          { x: 10, y: 10 },
          { x: 12, y: 11 },
          { x: 10, y: 10 },
        ],
        5,
      ),
    ).toBe(false)
  })
})

describe('lasso selection transaction', () => {
  const before = {
    selection: 'camera-path' as const,
    selectionIds: ['obj:subject', 'path:route-a'] as const,
    anchorRefs: [
      { pathId: 'route-a', anchorId: 'anchor-a' },
      { pathId: 'route-b', anchorId: 'anchor-b' },
    ] as const,
    activePathId: 'route-b',
  }

  it.each(['escape', 'pointercancel', 'teardown'] as const)(
    'restores the exact pre-gesture selection on %s',
    (reason) => {
      const snapshot = captureLassoSelectionSnapshot(before)
      const resolution = resolveLassoGestureFinish(snapshot, {
        kind: 'cancel',
        reason,
      })

      expect(resolution).toEqual({ kind: 'restore', snapshot: before })
      expect(resolution.kind === 'restore' && resolution.snapshot).not.toBe(before)
      expect(resolution.kind === 'restore' && resolution.snapshot.selectionIds).not.toBe(
        before.selectionIds,
      )
      expect(resolution.kind === 'restore' && resolution.snapshot.anchorRefs).not.toBe(
        before.anchorRefs,
      )
    },
  )

  it('applies an intentional empty completion instead of restoring the snapshot', () => {
    const resolution = resolveLassoGestureFinish(
      captureLassoSelectionSnapshot(before),
      { kind: 'complete', selectionIds: [], anchorRefs: [] },
    )

    expect(resolution).toEqual({
      kind: 'apply',
      selectionIds: [],
      anchorRefs: [],
    })
  })

  it('never mutates curve geometry while snapshotting, cancelling, or completing empty', () => {
    const paths = [{
      id: 'route-a',
      anchors: [{ id: 'anchor-a', position: [1, 2, 3] }],
    }]
    const geometryBefore = structuredClone(paths)
    const snapshot = captureLassoSelectionSnapshot(before)

    resolveLassoGestureFinish(snapshot, { kind: 'cancel', reason: 'escape' })
    resolveLassoGestureFinish(snapshot, { kind: 'cancel', reason: 'pointercancel' })
    resolveLassoGestureFinish(snapshot, { kind: 'cancel', reason: 'teardown' })
    resolveLassoGestureFinish(snapshot, { kind: 'complete', selectionIds: [], anchorRefs: [] })

    expect(paths).toEqual(geometryBefore)
  })
})
