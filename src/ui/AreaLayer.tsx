import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../state/useEditorStore'
import {
  computeRects,
  FIXED_VIEWS,
  leafList,
  useLayoutStore,
  type AreaNode,
  type PaneView,
} from '../state/useLayoutStore'

const VIEW_LABEL: Record<PaneView, string> = {
  editor: 'Editor',
  camera: 'Camera',
  front: 'Front',
  top: 'Top',
  right: 'Right',
}

const SPLIT_THRESHOLD = 24 // px of corner drag before a split fires
const JOIN_EDGE = 0.06 // divider dragged this close to an edge joins that pane

/** find the split node with `id` (for join-on-drag edge detection) */
function findSplit(node: AreaNode, id: string): Extract<AreaNode, { kind: 'split' }> | null {
  if (node.kind === 'leaf') return null
  if (node.id === id) return node
  return findSplit(node.a, id) ?? findSplit(node.b, id)
}

/**
 * Blender-style area chrome over the canvas: per-pane controls, draggable
 * dividers (drag to an edge to join), and a corner grip you drag inward to
 * split (drag direction picks horizontal vs vertical). Transparent elsewhere so
 * the canvas beneath still orbits/selects in the active pane.
 */
export function AreaLayer() {
  const root = useLayoutStore((s) => s.root)
  const activePaneId = useLayoutStore((s) => s.activePaneId)
  const playMode = useEditorStore((s) => s.playMode)
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (playMode) return null

  const { leaves, splits } = computeRects(root, { x: 0, y: 0, w: size.w, h: size.h })
  const store = useLayoutStore.getState()
  const singlePane = leafList(root).length <= 1

  const overlayRect = () => ref.current!.getBoundingClientRect()

  // ---- divider drag (resize, or join when dragged to an edge) ---------------
  const startDivider = (splitId: string, dir: 'v' | 'h', rect: { x: number; y: number; w: number; h: number }) =>
    (e: React.PointerEvent) => {
      e.stopPropagation()
      const ov = overlayRect()
      const onMove = (ev: PointerEvent) => {
        const raw =
          dir === 'v'
            ? (ev.clientX - ov.left - rect.x) / rect.w
            : (ev.clientY - ov.top - rect.y) / rect.h
        const sp = findSplit(useLayoutStore.getState().root, splitId)
        const active = useLayoutStore.getState().activePaneId
        if (sp && raw < JOIN_EDGE && sp.a.kind === 'leaf' && sp.a.id !== active) {
          store.joinPane(sp.a.id)
          stop()
        } else if (sp && raw > 1 - JOIN_EDGE && sp.b.kind === 'leaf' && sp.b.id !== active) {
          store.joinPane(sp.b.id)
          stop()
        } else {
          store.setSplitRatio(splitId, raw)
        }
      }
      const stop = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', stop)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', stop)
    }

  // ---- corner grip drag (split; direction of drag picks the axis) -----------
  const startCorner = (leafId: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    const ox = e.clientX
    const oy = e.clientY
    let done = false
    const onMove = (ev: PointerEvent) => {
      if (done) return
      const dx = ev.clientX - ox
      const dy = ev.clientY - oy
      if (Math.hypot(dx, dy) < SPLIT_THRESHOLD) return
      done = true
      store.splitPane(leafId, Math.abs(dx) >= Math.abs(dy) ? 'v' : 'h')
      stop()
    }
    const stop = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
  }

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-10">
      {/* dividers */}
      {splits.map((sp) => {
        const t = sp.rect
        const style =
          sp.dir === 'v'
            ? { left: t.x + t.w * sp.ratio - 3, top: t.y, width: 6, height: t.h, cursor: 'col-resize' as const }
            : { left: t.x, top: t.y + t.h * sp.ratio - 3, width: t.w, height: 6, cursor: 'row-resize' as const }
        return (
          <div
            key={sp.id}
            onPointerDown={startDivider(sp.id, sp.dir, t)}
            className="pointer-events-auto absolute bg-transparent hover:bg-accent/40"
            style={style}
          />
        )
      })}

      {/* per-pane control cluster + corner grip */}
      {leafList(root).map((leaf) => {
        const r = leaves.get(leaf.id)
        if (!r) return null
        const isActive = leaf.id === activePaneId
        return (
          <div key={leaf.id}>
            <div
              className="pointer-events-auto absolute flex items-center gap-1 rounded-md bg-panel/85 px-1.5 py-1 text-[10px] text-ink shadow-sm backdrop-blur-sm"
              style={{ left: r.x + 6, top: r.y + 6 }}
            >
              {isActive ? (
                <span className="px-1 font-medium text-accent">{VIEW_LABEL.editor}</span>
              ) : (
                <select
                  value={leaf.view}
                  onChange={(e) => store.setPaneView(leaf.id, e.target.value as PaneView)}
                  className="rounded bg-panel-2 px-1 py-0.5 text-[10px] text-ink outline-none"
                >
                  {FIXED_VIEWS.map((v) => (
                    <option key={v} value={v}>
                      {VIEW_LABEL[v]}
                    </option>
                  ))}
                </select>
              )}
              {!isActive && !singlePane && (
                <button
                  title="Close pane"
                  onClick={() => store.joinPane(leaf.id)}
                  className="rounded px-1 leading-none text-ink-dim hover:text-red-400"
                >
                  ×
                </button>
              )}
            </div>
            {/* corner grip: drag inward to split (like Blender's area corner) */}
            <div
              onPointerDown={startCorner(leaf.id)}
              title="Drag to split this pane"
              className="pointer-events-auto absolute"
              style={{
                left: r.x + r.w - 16,
                top: r.y + r.h - 16,
                width: 16,
                height: 16,
                cursor: 'nwse-resize',
                background:
                  'linear-gradient(315deg, rgb(255 255 255 / 0.5) 0 2px, transparent 2px 4px, rgb(255 255 255 / 0.5) 4px 6px, transparent 6px 8px)',
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
