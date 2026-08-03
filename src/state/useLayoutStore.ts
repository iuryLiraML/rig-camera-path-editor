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

/**
 * Named layouts, exposed in the viewport footer. The raw split/join gestures
 * stayed the only way in and out of a split, and none of them could return you
 * to a single pane — 'single' is the guaranteed way back.
 *
 * 'director' is the reason the split exists in this app: the point of this
 * editor is driving a camera along a path, so seeing the path and the resulting
 * framing at the same time is the actual job — the PiP did it by overlapping,
 * this does it side by side.
 */
export type LayoutPreset = 'single' | 'director' | 'quad'

const leaf = (id: string, view: PaneView): AreaNode => ({ kind: 'leaf', id, view })

/**
 * Where a preset's dividers go. Ratios are fractions of the whole canvas, but a
 * divider at 0.5 of the canvas is not at the middle of what the user sees — the
 * panels cover unequal strips — so the caller passes the ratios it wants,
 * measured against the free area.
 */
export interface PresetRatios {
  v: number
  h: number
}

const DEFAULT_RATIOS: PresetRatios = { v: 0.5, h: 0.5 }

/** deterministic trees, so the preset a user picks is the tree we can detect */
function presetTree(preset: LayoutPreset, ratios: PresetRatios = DEFAULT_RATIOS): AreaNode {
  if (preset === 'single') return leaf(ROOT_ID, 'editor')
  if (preset === 'director') {
    return {
      kind: 'split',
      id: 'split-root',
      dir: 'v',
      ratio: ratios.v,
      a: leaf(ROOT_ID, 'editor'),
      b: leaf('pane-camera', 'camera'),
    }
  }
  return {
    kind: 'split',
    id: 'split-root',
    dir: 'v',
    ratio: ratios.v,
    a: {
      kind: 'split',
      id: 'split-left',
      dir: 'h',
      ratio: ratios.h,
      a: leaf(ROOT_ID, 'editor'),
      b: leaf('pane-front', 'front'),
    },
    b: {
      kind: 'split',
      id: 'split-right',
      dir: 'h',
      ratio: ratios.h,
      a: leaf('pane-camera', 'camera'),
      b: leaf('pane-top', 'top'),
    },
  }
}

/** which preset the current tree is, ignoring divider positions ('' = custom) */
export function detectPreset(root: AreaNode): LayoutPreset | '' {
  const shape = (node: AreaNode): string =>
    node.kind === 'leaf' ? node.view : `(${node.dir}${shape(node.a)}${shape(node.b)})`
  const current = shape(root)
  for (const p of ['single', 'director', 'quad'] as const) {
    if (shape(presetTree(p)) === current) return p
  }
  return ''
}

interface LayoutState {
  root: AreaNode
  /** the single interactive pane (always view 'editor'); never removed */
  activePaneId: string
  /** split a pane in two; the new pane takes the first unused fixed view */
  splitPane: (id: string, dir: 'v' | 'h') => void
  /** close a (non-active) pane back into its sibling */
  joinPane: (id: string) => void
  setSplitRatio: (splitId: string, ratio: number) => void
  setPaneView: (id: string, view: PaneView) => void
  /** move the interactive editor into another pane; they swap views */
  setActivePane: (id: string) => void
  applyPreset: (preset: LayoutPreset, ratios?: PresetRatios) => void
  paneCount: () => number
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  root: presetTree('single'),
  activePaneId: ROOT_ID,

  splitPane: (id, dir) =>
    set((s) => {
      // every new pane defaulted to 'camera', so a hand-built quad showed the
      // same camera three times — take the first view not already on screen
      const used = new Set(leafList(s.root).map((l) => l.view))
      const view = FIXED_VIEWS.find((v) => !used.has(v)) ?? 'camera'
      return {
        root: replaceLeaf(s.root, id, (target) => ({
          kind: 'split',
          id: newId('split'),
          dir,
          ratio: 0.5,
          a: target, // keeps the original id (so the active pane stays valid)
          b: { kind: 'leaf', id: newId('pane'), view },
        })),
      }
    }),

  joinPane: (id) =>
    set((s) => (id === s.activePaneId ? s : { root: dropLeaf(s.root, id) })),

  setSplitRatio: (splitId, ratio) => set((s) => ({ root: setRatio(s.root, splitId, ratio) })),

  setPaneView: (id, view) => {
    // 'editor' is not a view you assign — it means "make this the active pane"
    if (view === 'editor') {
      get().setActivePane(id)
      return
    }
    if (id === get().activePaneId) return
    set((s) => ({ root: mapLeaf(s.root, id, { view }) }))
  },

  setActivePane: (id) =>
    set((s) => {
      if (id === s.activePaneId) return s
      const target = leafList(s.root).find((l) => l.id === id)
      if (!target) return s
      // the pane losing the editor inherits the view the new one was showing
      let root = mapLeaf(s.root, s.activePaneId, { view: target.view })
      root = mapLeaf(root, id, { view: 'editor' })
      return { root, activePaneId: id }
    }),

  applyPreset: (preset, ratios) =>
    set({ root: presetTree(preset, ratios), activePaneId: ROOT_ID }),

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
