import type { Tool, WorkspaceMode } from '../state/useEditorStore'
import { useEditorStore } from '../state/useEditorStore'
import { isPathStrokeTool } from './workspaceChrome'

/**
 * Pen listens on the canvas. Draw already learned that stealing LMB/wheel
 * while idle freezes the viewport; these helpers are the same contract.
 */

export function shouldHandlePenInput(): boolean {
  const editor = useEditorStore.getState()
  return !editor.cameraView && !editor.playMode && editor.workspaceMode === 'compose'
}

export function penStealsPointerButton(button: number): boolean {
  return button === 0
}

export function penStealsWheel(dragging: boolean): boolean {
  return dragging
}

interface StrokeState {
  playMode: boolean
  workspaceMode: WorkspaceMode
  tech: boolean
  cameraView: boolean
}

/** Where a stroke tool can author at all: Compose, shaded, not looking through. */
function strokeSurfaceLive(input: StrokeState): boolean {
  return (
    !input.playMode &&
    input.workspaceMode === 'compose' &&
    !input.tech &&
    !input.cameraView
  )
}

export function penToolShouldMount(input: StrokeState & {
  tool: Tool
  staticCamera: boolean
}): boolean {
  return input.tool === 'pen' && strokeSurfaceLive(input)
}

/**
 * Canvas cursor. Picking the Pen changed nothing on screen — no cursor, and the
 * ghost marker only appears on the first pointermove — so an armed Pen and a
 * dead build looked identical, and a white screen read as a broken tool. Shares
 * `strokeSurfaceLive` with the mount gate so the crosshair can never promise a
 * click the canvas would drop.
 */
export function strokeCursor(input: StrokeState & { tool: Tool }): 'crosshair' | undefined {
  return isPathStrokeTool(input.tool) && strokeSurfaceLive(input) ? 'crosshair' : undefined
}

/** Inactive path points remain selectable in Pen; active controls use the canvas picker. */
export function pathGizmoStealsStroke(tool: Tool): boolean {
  return tool !== 'draw'
}

/** Click the first point within this many CSS pixels to close the loop. */
export const PEN_CLOSE_LOOP_PX = 12

export function penClosesLoop(
  cssX: number,
  cssY: number,
  firstAnchorScreen: { x: number; y: number } | null,
  anchorCount: number,
): boolean {
  if (anchorCount <= 2 || !firstAnchorScreen) return false
  return Math.hypot(cssX - firstAnchorScreen.x, cssY - firstAnchorScreen.y) <= PEN_CLOSE_LOOP_PX
}

/** Drag past this length pulls a Bézier handle instead of leaving a corner. */
export const PEN_CURVE_DRAG = 0.05
