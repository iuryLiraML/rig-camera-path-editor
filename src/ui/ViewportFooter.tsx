import { useEditorStore, type Projection, type QuickView, type ViewMode } from '../state/useEditorStore'
import { detectPreset, leafList, useLayoutStore, type LayoutPreset } from '../state/useLayoutStore'
import { freeAreaRect, GUTTER, useViewportInsets, useWindowSize } from './viewportInsets'

const VIEWS: { value: QuickView; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'top', label: 'Top' },
  { value: 'right', label: 'Right' },
]

const MODES: { value: ViewMode; label: string }[] = [
  { value: 'clay', label: 'Clay' },
  { value: 'depth', label: 'Depth' },
  { value: 'outline', label: 'Outline' },
  { value: 'normals', label: 'Normals' },
]

/** Layout presets — see useLayoutStore for why these exist. */
const LAYOUTS: { value: LayoutPreset; label: string; title: string }[] = [
  { value: 'single', label: 'Single', title: 'One viewport' },
  {
    value: 'director',
    label: 'Director',
    title: 'Editor beside the camera view — edit the path and watch the framing at once',
  },
  { value: 'quad', label: 'Quad', title: 'Editor, camera, front and top views' },
]

export function ViewportFooter() {
  const cameraView = useEditorStore((s) => s.cameraView)
  const projection = useEditorStore((s) => s.projection)
  const setProjection = useEditorStore((s) => s.setProjection)
  const requestView = useEditorStore((s) => s.requestView)
  const viewMode = useEditorStore((s) => s.viewMode)
  const setViewMode = useEditorStore((s) => s.setViewMode)
  // the free area already accounts for the always-mounted timeline dock
  const insets = useViewportInsets()
  const paneCount = useLayoutStore((s) => leafList(s.root).length)
  const preset = useLayoutStore((s) => detectPreset(s.root))
  const win = useWindowSize()

  if (cameraView) return null

  // put the dividers in the middle of the *visible* viewport, not of the canvas
  const free = freeAreaRect(insets, win.h)
  const presetRatios = {
    v: (free.x + free.w * 0.55) / Math.max(1, win.w),
    h: (free.y + free.h * 0.5) / Math.max(1, win.h),
  }

  return (
    <div
      // wraps instead of sliding under the panels when the free area is narrow
      // (the assistant tab is 80 px wider than the design tab)
      className="absolute z-20 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2"
      style={{
        left: insets.centre,
        bottom: insets.bottom + GUTTER,
        maxWidth: insets.right - insets.left,
      }}
    >
      <div className="flex rounded-full bg-panel/90 p-0.5 shadow-lg backdrop-blur">
        {MODES.map((mode) => (
          <button
            key={mode.value}
            onClick={() => setViewMode(mode.value)}
            title={`Render the viewport, preview and exports as ${mode.label.toLowerCase()}`}
            className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
              viewMode === mode.value ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:text-ink'
            }`}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div className="flex rounded-full bg-panel/90 p-0.5 shadow-lg backdrop-blur">
        {VIEWS.map((view) => (
          <button
            key={view.value}
            onClick={() => requestView(view.value)}
            title={`Snap the editor camera to the ${view.label.toLowerCase()} view`}
            className="rounded-full px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:text-ink"
          >
            {view.label}
          </button>
        ))}
      </div>

      {/* one toggle, not a pair: the two spelled-out options were 180 px of the
          footer, which pushed the whole row onto a second line */}
      <div className="flex rounded-full bg-panel/90 p-0.5 shadow-lg backdrop-blur">
        <button
          onClick={() =>
            setProjection(
              (projection === 'perspective' ? 'orthographic' : 'perspective') as Projection,
            )
          }
          title={`Projection: ${projection}. Click to switch to ${
            projection === 'perspective' ? 'orthographic' : 'perspective'
          }.`}
          className="rounded-full px-3 py-1 text-[11px] text-ink transition-colors hover:bg-panel-3"
        >
          {projection === 'perspective' ? 'Persp' : 'Ortho'}
        </button>
      </div>

      {/* viewport layout. The two raw "split" buttons offered no way back to a
          single pane, and a new pane always defaulted to the camera view, so the
          feature had no obvious purpose — these name the layouts that do. */}
      <div className="flex items-center rounded-full bg-panel/90 p-0.5 shadow-lg backdrop-blur">
        {LAYOUTS.map((option) => (
          <button
            key={option.value}
            onClick={() => useLayoutStore.getState().applyPreset(option.value, presetRatios)}
            title={option.title}
            className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
              preset === option.value ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
        {!preset && (
          <span className="px-2 text-[10px] text-ink-dim" title="Custom split layout">
            {paneCount} panes
          </span>
        )}
      </div>
    </div>
  )
}
