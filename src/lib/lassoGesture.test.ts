import { describe, expect, it } from 'vitest'
import {
  hasLassoDrag,
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
