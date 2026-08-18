export type Vec3 = [number, number, number]

const DEFAULT_SPACING = 1.8

function boxCenterX(box: unknown): number | null {
  if (Array.isArray(box) && typeof box[0] === 'number' && Number.isFinite(box[0])) {
    return box[0]
  }
  return null
}

/**
 * Side-by-side floor slots so each SAM person is a separately posed object.
 * Left-to-right follows SAM box cx when present; otherwise mask order.
 */
export function layoutPeoplePositions(
  count: number,
  boxes?: unknown[],
  spacing = DEFAULT_SPACING,
): Vec3[] {
  if (count <= 0) return []
  if (count === 1) return [[0, 0, 0]]

  const ranked = Array.from({ length: count }, (_, i) => ({
    i,
    cx: boxCenterX(boxes?.[i]) ?? i,
  })).sort((a, b) => a.cx - b.cx || a.i - b.i)

  const slots: Vec3[] = Array.from({ length: count }, () => [0, 0, 0])
  ranked.forEach((item, slot) => {
    slots[item.i] = [(slot - (count - 1) / 2) * spacing, 0, 0]
  })
  return slots
}

export function personObjectName(index: number, count: number): string {
  return count > 1 ? `Person ${index + 1}` : 'Person'
}
