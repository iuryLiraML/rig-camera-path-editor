export type LayoutTier = 'full' | 'compact' | 'unsupported'
export type DirectorPreference = 'auto' | 'expanded' | 'compact'

export const FULL_LAYOUT_MIN = { w: 1024, h: 700 }
export const COMPACT_LAYOUT_MIN = { w: 768, h: 600 }

export function layoutTier(width: number, height: number): LayoutTier {
  if (width < COMPACT_LAYOUT_MIN.w || height < COMPACT_LAYOUT_MIN.h) return 'unsupported'
  if (width < FULL_LAYOUT_MIN.w || height < FULL_LAYOUT_MIN.h) return 'compact'
  return 'full'
}

/**
 * Compact rail on every non-full layout, including 1024×600. Persisted
 * expanded may win only at full size (≥1024×700). Compact still wins below 768.
 */
export function directorIsCompact(
  width: number,
  height: number,
  preference: DirectorPreference,
): boolean {
  if (layoutTier(width, height) !== 'full') return true
  return preference === 'compact'
}
