/** Viewport selection chrome. Overlay only — never a clay or light change. */

export function objectSelectionChrome(input: { selected: boolean }) {
  return {
    outline: input.selected,
    clayEmissive: 0,
  }
}
