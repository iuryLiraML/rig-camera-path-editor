import { useEditorStore } from '../state/useEditorStore'
import { useCameraReady } from '../state/cameraPathLink'
import {
  computeRects,
  FIXED_VIEWS,
  leafList,
  useLayoutStore,
  type AreaNode,
  type PaneView,
  type Rect,
} from '../state/useLayoutStore'
import { exportDimensions } from '../lib/recorder'
import { freeAreaRect, intersectRect, useViewportInsets, useWindowSize } from './viewportInsets'

const VIEW_LABEL: Record<PaneView, string> = {
  editor: 'Editor',
  camera: 'Camera',
  front: 'Front',
  top: 'Top',
  right: 'Right',
}

const SPLIT_THRESHOLD = 24 // px of corner drag before a split fires
const JOIN_EDGE = 0.06 // divider dragged this close to an edge joins that pane
const GRIP = 16

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
  const hasCameraPath = useCameraReady()
  const exportAspect = useEditorStore((s) => s.exportAspect)
  const exportRes = useEditorStore((s) => s.exportRes)
  const customSize = useEditorStore((s) => s.customSize)
  // measured from the window, not from this overlay: the element is unmounted
  // while single-pane, so a ResizeObserver on it reported 0x0 and every pane's
  // chrome collapsed into the same corner
  const win = useWindowSize()
  const insets = useViewportInsets(win.w)

  if (playMode || leafList(root).length <= 1) return null

  const free = freeAreaRect(insets, win.h)
  const { leaves, splits } = computeRects(root, { x: 0, y: 0, w: win.w, h: win.h })
  const store = useLayoutStore.getState()

  // ---- divider drag (resize, or join when dragged to an edge) ---------------
  const startDivider = (splitId: string, dir: 'v' | 'h', rect: Rect) => (e: React.PointerEvent) => {
    e.stopPropagation()
    const onMove = (ev: PointerEvent) => {
      const raw =
        dir === 'v' ? (ev.clientX - rect.x) / rect.w : (ev.clientY - rect.y) / rect.h
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
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* dividers — clipped to the free area so the grab strip is never under a
          panel, and given a visible seam (they used to be fully transparent) */}
      {splits.map((sp) => {
        const t = sp.rect
        let style: React.CSSProperties
        if (sp.dir === 'v') {
          const x = t.x + t.w * sp.ratio
          const top = Math.max(t.y, free.y)
          const height = Math.min(t.y + t.h, free.y + free.h) - top
          if (height < 12 || x < free.x || x > free.x + free.w) return null
          style = { left: x - 3, top, width: 6, height, cursor: 'col-resize' }
        } else {
          const y = t.y + t.h * sp.ratio
          const left = Math.max(t.x, free.x)
          const width = Math.min(t.x + t.w, free.x + free.w) - left
          if (width < 12 || y < free.y || y > free.y + free.h) return null
          style = { left, top: y - 3, width, height: 6, cursor: 'row-resize' }
        }
        return (
          <div
            key={sp.id}
            onPointerDown={startDivider(sp.id, sp.dir, t)}
            title="Drag to resize · drag to the far edge to close a pane"
            className="pointer-events-auto absolute flex items-center justify-center bg-white/10 hover:bg-accent/50"
            style={style}
          >
            <span
              className={`rounded-full bg-white/25 ${
                sp.dir === 'v' ? 'h-6 w-0.5' : 'h-0.5 w-6'
              }`}
            />
          </div>
        )
      })}

      {/* per-pane control cluster + corner grip */}
      {leafList(root).map((pane) => {
        const r = leaves.get(pane.id)
        if (!r) return null
        const vis = intersectRect(r, free)
        if (vis.w <= 0 || vis.h <= 0) return null
        const isActive = pane.id === activePaneId
        const roomForCluster = vis.w >= 92 && vis.h >= 40
        const roomForGrip = vis.w >= 56 && vis.h >= 56
        return (
          <div key={pane.id}>
            {/* gizmos live here; Front/Top/Right can still be orbited */}
            {isActive && (
              <div
                className="absolute rounded-sm border border-accent/50"
                style={{ left: vis.x + 1, top: vis.y + 1, width: vis.w - 2, height: vis.h - 2 }}
              />
            )}
            {roomForCluster && (
              <div
                className="pointer-events-auto absolute flex items-center gap-1 rounded-md bg-panel/85 px-1.5 py-1 text-[10px] text-ink shadow-sm backdrop-blur-sm"
                style={{ left: vis.x + 6, top: vis.y + 6 }}
              >
                {isActive ? (
                  <span className="px-1 font-medium text-accent" title="Gizmos live in this pane">
                    {VIEW_LABEL.editor}
                  </span>
                ) : (
                  <select
                    value={pane.view}
                    onChange={(e) => store.setPaneView(pane.id, e.target.value as PaneView)}
                    title="What this pane shows. Front, Top and Right can be orbited — pick Editor to move gizmos here"
                    className="rounded bg-panel-2 px-1 py-0.5 text-[10px] text-ink outline-none"
                  >
                    {FIXED_VIEWS.map((v) => (
                      <option key={v} value={v}>
                        {VIEW_LABEL[v]}
                      </option>
                    ))}
                    <option value="editor">Editor (move gizmos here)</option>
                  </select>
                )}
                {!isActive && (
                  <button
                    title="Close pane"
                    onClick={() => store.joinPane(pane.id)}
                    className="rounded px-1 leading-none text-ink-dim hover:text-red-400"
                  >
                    ×
                  </button>
                )}
              </div>
            )}
            {/* A camera pane fills its own aspect, which is not the aspect you
                export — the PiP always drew this guide, and without it the pane
                is a misleading preview of the shot. */}
            {pane.view === 'camera' && hasCameraPath && (
              <div
                className="absolute overflow-hidden"
                style={{ left: vis.x, top: vis.y, width: vis.w, height: vis.h }}
              >
                {(() => {
                  const [tw, th] = exportDimensions(exportAspect, exportRes, customSize)
                  const target = tw / th
                  const paneAspect = vis.w / Math.max(1, vis.h)
                  const gw = target < paneAspect ? vis.h * target : vis.w
                  const gh = target < paneAspect ? vis.h : vis.w / target
                  return (
                    <div
                      className="absolute border border-white/40"
                      style={{
                        left: (vis.w - gw) / 2,
                        top: (vis.h - gh) / 2,
                        width: gw,
                        height: gh,
                        boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)',
                      }}
                    />
                  )
                })()}
              </div>
            )}
            {/* a 'camera' pane renders nothing without a path — say why, since the
                region would otherwise just sit there cleared and unexplained */}
            {pane.view === 'camera' && !hasCameraPath && vis.w >= 120 && (
              <div
                className="absolute flex items-center justify-center"
                style={{ left: vis.x, top: vis.y, width: vis.w, height: vis.h }}
              >
                <span className="rounded-md bg-panel/85 px-3 py-1.5 text-[11px] text-ink-dim">
                  No camera path yet — press P to draw one
                </span>
              </div>
            )}
            {/* corner grip: drag inward to split (like Blender's area corner) */}
            {roomForGrip && (
              <div
                onPointerDown={startCorner(pane.id)}
                title="Drag to split this pane"
                className="pointer-events-auto absolute"
                style={{
                  left: vis.x + vis.w - GRIP,
                  top: vis.y + vis.h - GRIP,
                  width: GRIP,
                  height: GRIP,
                  cursor: 'nwse-resize',
                  background:
                    'linear-gradient(315deg, rgb(255 255 255 / 0.5) 0 2px, transparent 2px 4px, rgb(255 255 255 / 0.5) 4px 6px, transparent 6px 8px)',
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
