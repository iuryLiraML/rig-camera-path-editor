import { GUTTER, useViewportInsets } from './viewportInsets'

export function NavLegend() {
  const insets = useViewportInsets()
  return (
    <div
      className="pointer-events-none absolute z-20 flex items-center gap-3 text-[10px] text-ink-dim"
      style={{ left: insets.left, bottom: insets.bottom + GUTTER }}
    >
      <span>Orbit · LMB</span>
      <span>Pan · RMB / MMB</span>
      <span>Zoom · Scroll</span>
      <span>Frame · F</span>
    </div>
  )
}
