import type {
  SelectableId,
  SelectionMemberId,
  Tool,
} from '../state/useEditorStore'
import type { PaneView } from '../state/useLayoutStore'
import type { AnchorRef } from '../state/usePathStore'
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

export interface LassoSelectionSnapshot {
  selection: SelectableId | null
  selectionIds: readonly SelectionMemberId[]
  anchorRefs: readonly AnchorRef[]
  activePathId: string
}

export type LassoCancelReason = 'escape' | 'pointercancel' | 'teardown'

export type LassoGestureFinish =
  | { kind: 'cancel'; reason: LassoCancelReason }
  | {
      kind: 'complete'
      selectionIds: readonly SelectionMemberId[]
      anchorRefs: readonly AnchorRef[]
    }

export type LassoGestureResolution =
  | { kind: 'restore'; snapshot: LassoSelectionSnapshot }
  | {
      kind: 'apply'
      selectionIds: SelectionMemberId[]
      anchorRefs: AnchorRef[]
    }

function cloneSelectionSnapshot(
  snapshot: LassoSelectionSnapshot,
): LassoSelectionSnapshot {
  return {
    selection: snapshot.selection,
    selectionIds: [...snapshot.selectionIds],
    anchorRefs: snapshot.anchorRefs.map((ref) => ({ ...ref })),
    activePathId: snapshot.activePathId,
  }
}

export function captureLassoSelectionSnapshot(
  state: LassoSelectionSnapshot,
): LassoSelectionSnapshot {
  return cloneSelectionSnapshot(state)
}

export function resolveLassoGestureFinish(
  snapshot: LassoSelectionSnapshot,
  finish: LassoGestureFinish,
): LassoGestureResolution {
  if (finish.kind === 'cancel') {
    return { kind: 'restore', snapshot: cloneSelectionSnapshot(snapshot) }
  }
  return {
    kind: 'apply',
    selectionIds: [...finish.selectionIds],
    anchorRefs: finish.anchorRefs.map((ref) => ({ ...ref })),
  }
}
