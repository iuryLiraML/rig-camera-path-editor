import type { Object3D } from 'three'

export type PickKind = 'gizmo' | 'object' | 'camera' | 'target' | 'path-anchor' | 'path-line'

const RANK: Record<PickKind, number> = {
  gizmo: 0,
  object: 1,
  camera: 2,
  target: 2,
  'path-anchor': 3,
  'path-line': 4,
}

export type TaggedHit<T> = {
  hit: T
  kind: PickKind
  id?: string
  distance: number
}

let lastCycle: { x: number; y: number; key: string; index: number } | null = null
let pointer = { x: 0, y: 0 }
let pendingClick = false

export function setPickPointer(x: number, y: number) {
  pointer = { x, y }
}

/** Call on left-button down so stacked objects cycle only on click, not hover. */
export function beginPickClick(x: number, y: number) {
  pointer = { x, y }
  pendingClick = true
}

export function resetPickCycle() {
  lastCycle = null
  pendingClick = false
}

function isTransformControl(object: Object3D): boolean {
  let node: Object3D | null = object
  while (node) {
    const type = node.type
    if (
      type === 'TransformControls' ||
      type === 'TransformControlsRoot' ||
      type === 'TransformControlsGizmo' ||
      type === 'TransformControlsPlane'
    ) {
      return true
    }
    if (typeof node.name === 'string' && node.name.startsWith('TransformControls')) return true
    node = node.parent
  }
  return false
}

export function pickKindOf(object: Object3D): PickKind | null {
  if (isTransformControl(object)) return 'gizmo'
  let node: Object3D | null = object
  while (node) {
    const kind = node.userData.pickKind as PickKind | undefined
    if (kind) return kind
    node = node.parent
  }
  return null
}

export function pickIdOf(object: Object3D): string | undefined {
  let node: Object3D | null = object
  while (node) {
    const id = node.userData.pickId as string | undefined
    if (id) return id
    node = node.parent
  }
  return undefined
}

export function tagHits<T extends { object: Object3D; distance: number }>(hits: T[]): TaggedHit<T>[] {
  const out: TaggedHit<T>[] = []
  for (const hit of hits) {
    const kind = pickKindOf(hit.object)
    if (!kind) continue
    out.push({ hit, kind, id: pickIdOf(hit.object), distance: hit.distance })
  }
  return out
}

/**
 * Scene objects beat the path and the camera icon when they sit on the same
 * click. Repeated clicks in the same spot cycle stacked objects.
 */
export function preferTaggedHits<T>(tagged: TaggedHit<T>[]): TaggedHit<T>[] {
  if (tagged.length === 0) return tagged
  const closest = Math.min(...tagged.map((item) => item.distance))
  const slack = Math.max(0.14, closest * 0.1)
  const near = tagged.filter((item) => item.distance <= closest + slack)
  const best = Math.min(...near.map((item) => RANK[item.kind]))
  let chosen = near.filter((item) => RANK[item.kind] === best)
  if (best === RANK.object && chosen.length > 1) {
    chosen = cycleObjects(chosen)
  }
  const rest = tagged.filter((item) => !chosen.includes(item))
  return [...chosen, ...rest]
}

function cycleObjects<T>(hits: TaggedHit<T>[]): TaggedHit<T>[] {
  const key = hits
    .map((item) => item.id ?? '')
    .sort()
    .join('|')
  const nearLast =
    lastCycle &&
    lastCycle.key === key &&
    (pointer.x - lastCycle.x) ** 2 + (pointer.y - lastCycle.y) ** 2 < 36

  if (!pendingClick) {
    if (nearLast && lastCycle) return rotate(hits, lastCycle.index)
    return hits
  }
  pendingClick = false
  if (nearLast && lastCycle) {
    lastCycle.index = (lastCycle.index + 1) % hits.length
    lastCycle.x = pointer.x
    lastCycle.y = pointer.y
  } else {
    lastCycle = { x: pointer.x, y: pointer.y, key, index: 0 }
  }
  return rotate(hits, lastCycle.index)
}

function rotate<T>(hits: TaggedHit<T>[], index: number): TaggedHit<T>[] {
  const i = ((index % hits.length) + hits.length) % hits.length
  return [...hits.slice(i), ...hits.slice(0, i)]
}

/** R3F `events.filter` — drop unmarked helpers, prefer objects over the spline. */
export function filterViewportHits<T extends { object: Object3D; distance: number }>(hits: T[]): T[] {
  return preferTaggedHits(tagHits(hits)).map((item) => item.hit)
}

/** True when a left-click should hold orbit (not a fat spline miss). */
export function hasInteractivePick(hits: { object: Object3D; distance: number }[]): boolean {
  return tagHits(hits).some((item) => item.kind !== 'path-line')
}
