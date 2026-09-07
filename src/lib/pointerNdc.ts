/**
 * CSS-pixel pointer position from client coordinates and the canvas box.
 * Never use offsetX/offsetY — Safari disagrees with Chrome on canvas.
 */
export function cssPointFromClient(
  clientX: number,
  clientY: number,
  canvas: Pick<Element, 'getBoundingClientRect'>,
): { x: number; y: number; width: number; height: number } | null {
  const rect = canvas.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null
  return { x, y, width: rect.width, height: rect.height }
}

export function ndcFromPane(
  x: number,
  y: number,
  pane: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  return {
    x: ((x - pane.x) / Math.max(1, pane.w)) * 2 - 1,
    y: -((y - pane.y) / Math.max(1, pane.h)) * 2 + 1,
  }
}

/**
 * Safari's R3F synthetic PointerEvent often leaves shiftKey false while
 * nativeEvent.shiftKey is true. Dual-read so Shift+click additive select
 * still works there (same class of Safari pointer disagreement as offsetX).
 */
export function eventShiftHeld(e: {
  shiftKey?: boolean
  nativeEvent: { shiftKey: boolean }
}): boolean {
  return Boolean(e.shiftKey || e.nativeEvent.shiftKey)
}
