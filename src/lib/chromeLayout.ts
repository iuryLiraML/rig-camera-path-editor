export type LayoutTier = 'phone' | 'tablet' | 'compact' | 'full'
export type DirectorPreference = 'auto' | 'expanded' | 'compact'

/**
 * Four size-based layout tiers (issue #66). The tier is derived from the free
 * width and height, never from a user-agent or device brand — a small desktop
 * window and a tablet land on the same tier when they measure the same. Input
 * capability (mouse / touch / pen) is independent of the tier.
 *
 * - `full`    — desktop with room for the expanded Director and docked panels.
 * - `compact` — the laptop/netbook band; panels dock with the compact Director.
 * - `tablet`  — iPad-class widths; panels still dock (refined per-panel in #71).
 * - `phone`   — narrow or short viewports; no persistent rails, one Task panel
 *               at a time in a bottom sheet over a full-bleed canvas.
 */
export const FULL_LAYOUT_MIN = { w: 1024, h: 700 }
/** Below this width a viewport is a phone rather than a tablet. */
export const PHONE_MAX_WIDTH = 600
/** At or above this width the desktop tiers (compact / full) begin. */
export const DESKTOP_MIN_WIDTH = 1024
/**
 * Below this height even a wide window is treated as a phone: a landscape phone
 * (844×390) or a very short window cannot dock a side rail without crushing the
 * canvas. A short *desktop-width* window stays compact so the laptop keeps its
 * panels — the timeline shrinks instead (see `chromeSizes`).
 */
export const SHORT_HEIGHT = 500

/** Retained for callers that referenced the old compact floor. */
export const COMPACT_LAYOUT_MIN = { w: 768, h: 600 }

export function layoutTier(width: number, height: number): LayoutTier {
  // Short landscape windows: a phone on its side, unless it is desktop-wide.
  if (height < SHORT_HEIGHT) return width < DESKTOP_MIN_WIDTH ? 'phone' : 'compact'
  // Narrow portrait — phones.
  if (width < PHONE_MAX_WIDTH) return 'phone'
  // Tablet-class: portrait tablets and narrow windows above phone width.
  if (width < DESKTOP_MIN_WIDTH) return 'tablet'
  // Desktop widths split on height into compact and full.
  if (height < FULL_LAYOUT_MIN.h) return 'compact'
  return 'full'
}

/** The phone shell: a single Task panel at a time, no persistent docked rails. */
export function isPhoneTier(tier: LayoutTier): boolean {
  return tier === 'phone'
}

/**
 * Compact rail on every non-full layout, including 1024×600 and the tablet
 * band. Persisted expanded may win only at full size (≥1024×700). Compact still
 * wins below that.
 */
export function directorIsCompact(
  width: number,
  height: number,
  preference: DirectorPreference,
): boolean {
  if (layoutTier(width, height) !== 'full') return true
  return preference === 'compact'
}
