import { create } from 'zustand'

/** what a pane shows. 'editor' = the interactive orbit camera (only the active pane). */
export type PaneView = 'editor' | 'camera' | 'front' | 'top' | 'right'

/** Binary area tree, à la Blender. dir 'v' = side-by-side, 'h' = stacked. */
export type AreaNode =
  | { kind: 'leaf'; id: string; view: PaneView }
  | { kind: 'split'; id: string; dir: 'v' | 'h'; ratio: number; a: AreaNode; b: AreaNode }

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** the fixed views a secondary pane can cycle through */
export const FIXED_VIEWS: PaneView[] = ['camera', 'front', 'top', 'right']

let nid = 1
const newId = (p: string) => `${p}-${nid++}`

const MIN_RATIO = 0.12

// ---- tree helpers -----------------------------------------------------------

function replaceLeaf(node: AreaNode, id: string, make: (leaf: Extract<AreaNode, { kind: 'leaf' }>) => AreaNode): AreaNode {
  if (node.kind === 'leaf') return node.id === id ? make(node) : node
  return { ...node, a: replaceLeaf(node.a, id, make), b: replaceLeaf(node.b, id, make) }
}

function mapLeaf(node: AreaNode, id: string, patch: Partial<Extract<AreaNode, { kind: 'leaf' }>>): AreaNode {
  if (node.kind === 'leaf') return node.id === id ? { ...node, ...patch } : node
  return { ...node, a: mapLeaf(node.a, id, patch), b: mapLeaf(node.b, id, patch) }
}

/** drop a leaf: the parent split collapses to the surviving sibling. */
function dropLeaf(node: AreaNode, id: string): AreaNode {
  if (node.kind === 'leaf') return node
  if (node.a.kind === 'leaf' && node.a.id === id) return node.b
  if (node.b.kind === 'leaf' && node.b.id === id) return node.a
  return { ...node, a: dropLeaf(node.a, id), b: dropLeaf(node.b, id) }
}

function setRatio(node: AreaNode, splitId: string, ratio: number): AreaNode {
  if (node.kind === 'leaf') return node
  if (node.id === splitId) return { ...node, ratio: Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio)) }
  return { ...node, a: setRatio(node.a, splitId, ratio), b: setRatio(node.b, splitId, ratio) }
}

export function leafList(node: AreaNode): Extract<AreaNode, { kind: 'leaf' }>[] {
  return node.kind === 'leaf' ? [node] : [...leafList(node.a), ...leafList(node.b)]
}

/** Tile a rect over the tree. Returns leaf rects + split dividers (parent rect + dir). */
export function computeRects(
  node: AreaNode,
  rect: Rect,
  leaves: Map<string, Rect> = new Map(),
  splits: { id: string; dir: 'v' | 'h'; ratio: number; rect: Rect }[] = [],
): { leaves: Map<string, Rect>; splits: { id: string; dir: 'v' | 'h'; ratio: number; rect: Rect }[] } {
  if (node.kind === 'leaf') {
    leaves.set(node.id, rect)
    return { leaves, splits }
  }
  splits.push({ id: node.id, dir: node.dir, ratio: node.ratio, rect })
  if (node.dir === 'v') {
    const wa = rect.w * node.ratio
    computeRects(node.a, { x: rect.x, y: rect.y, w: wa, h: rect.h }, leaves, splits)
    computeRects(node.b, { x: rect.x + wa, y: rect.y, w: rect.w - wa, h: rect.h }, leaves, splits)
  } else {
    const ha = rect.h * node.ratio
    computeRects(node.a, { x: rect.x, y: rect.y, w: rect.w, h: ha }, leaves, splits)
    computeRects(node.b, { x: rect.x, y: rect.y + ha, w: rect.w, h: rect.h - ha }, leaves, splits)
  }
  return { leaves, splits }
}

// ---- store ------------------------------------------------------------------

const ROOT_ID = 'pane-editor'

interface LayoutState {
  root: AreaNode
  /** the single interactive pane (always view 'editor'); never removed */
  activePaneId: string
  /** split a pane in two; the new pane is a fixed view */
  splitPane: (id: string, dir: 'v' | 'h') => void
  /** close a (non-active) pane back into its sibling */
  joinPane: (id: string) => void
  setSplitRatio: (splitId: string, ratio: number) => void
  setPaneView: (id: string, view: PaneView) => void
  paneCount: () => number
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  root: { kind: 'leaf', id: ROOT_ID, view: 'editor' },
  activePaneId: ROOT_ID,

  splitPane: (id, dir) =>
    set((s) => ({
      root: replaceLeaf(s.root, id, (leaf) => ({
        kind: 'split',
        id: newId('split'),
        dir,
        ratio: 0.5,
        a: leaf, // keeps the original id (so the active pane stays valid)
        b: { kind: 'leaf', id: newId('pane'), view: 'camera' },
      })),
    })),

  joinPane: (id) =>
    set((s) => (id === s.activePaneId ? s : { root: dropLeaf(s.root, id) })),

  setSplitRatio: (splitId, ratio) => set((s) => ({ root: setRatio(s.root, splitId, ratio) })),

  setPaneView: (id, view) =>
    set((s) => {
      // the active pane stays 'editor'; only secondary panes take a fixed view
      if (id === s.activePaneId || view === 'editor') return s
      return { root: mapLeaf(s.root, id, { view }) }
    }),

  paneCount: () => leafList(get().root).length,
}))

/** rect (CSS px, top-left origin) of the interactive pane within a wxh viewport */
export function activePaneRect(width: number, height: number): Rect {
  const { root, activePaneId } = useLayoutStore.getState()
  const { leaves } = computeRects(root, { x: 0, y: 0, w: width, h: height })
  return leaves.get(activePaneId) ?? { x: 0, y: 0, w: width, h: height }
}

export function rectContains(r: Rect, px: number, py: number) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
}
