import type { Tool } from '../state/useEditorStore'
import type { PaneView } from '../state/useLayoutStore'
import type { ScreenPoint } from './lasso'

export interface LassoGateInput {
  button: number
  shiftKey: boolean
  background: boolean
  paneView: PaneView
  activePane: boolean
  tool: Tool
  sceneEditing: boolean
  cameraView: boolean
}

export function shouldArmLasso(input: LassoGateInput): boolean {
  return (
    input.button === 0 &&
    input.shiftKey &&
    input.background &&
    input.paneView === 'editor' &&
    input.activePane &&
    input.tool === 'select' &&
    input.sceneEditing &&
    !input.cameraView
  )
}

export function shouldSuppressMissedClick(completedLasso: boolean): boolean {
  return completedLasso
}

/** A closed freehand loop ends near its start, so use its furthest point. */
export function hasLassoDrag(
  points: readonly ScreenPoint[],
  threshold: number,
): boolean {
  if (points.length < 3) return false
  const start = points[0]
  return points.some((point) => Math.hypot(point.x - start.x, point.y - start.y) >= threshold)
}
