/**
 * Handle into the R3F render loop for code that lives outside the Canvas
 * (the video exporter). Set by RenderBridge inside Viewport.
 */
export const renderBridge: {
  advance: ((timestamp: number) => void) | null
  setFrameloop: ((mode: 'always' | 'never' | 'demand') => void) | null
} = {
  advance: null,
  setFrameloop: null,
}
