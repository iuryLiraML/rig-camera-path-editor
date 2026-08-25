import type { ReactNode } from 'react'
import { useEditorStore, type Projection, type QuickView, type ViewMode } from '../state/useEditorStore'
import { detectPreset, leafList, useLayoutStore, type LayoutPreset } from '../state/useLayoutStore'
import { LookCluster } from './LookCluster'
import { EyeIcon, EyeOffIcon } from './icons'
import { chromeBand, GUTTER, useViewportInsets, useWindowSize } from './viewportInsets'

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

export function ViewportFooter({ center }: { center?: ReactNode }) {
  const cameraView = useEditorStore((s) => s.cameraView)
  const projection = useEditorStore((s) => s.projection)
  const setProjection = useEditorStore((s) => s.setProjection)
  const requestView = useEditorStore((s) => s.requestView)
  const viewMode = useEditorStore((s) => s.viewMode)
  const setViewMode = useEditorStore((s) => s.setViewMode)
  const showSceneObjects = useEditorStore((s) => s.showSceneObjects)
  const toggleShowSceneObjects = useEditorStore((s) => s.toggleShowSceneObjects)
  const insets = useViewportInsets()
  const paneCount = useLayoutStore((s) => leafList(s.root).length)
  const preset = useLayoutStore((s) => detectPreset(s.root))
  const win = useWindowSize()
  const band = chromeBand(insets, win.w)

  if (cameraView) return null

  const free = {
    x: band.left,
    w: Math.max(0, band.width),
    y: insets.top,
    h: Math.max(0, win.h - insets.bottom - insets.top),
  }
  const presetRatios = {
    v: (free.x + free.w * 0.55) / Math.max(1, win.w),
    h: (free.y + free.h * 0.5) / Math.max(1, win.h),
  }

  return (
    <div
      className="pointer-events-none absolute z-20 flex flex-nowrap items-center gap-2"
      style={{
        left: band.left,
        width: band.width,
        bottom: insets.bottom + GUTTER,
      }}
    >
      <div className="pointer-events-auto flex min-w-0 flex-1 items-center justify-start gap-2">
        <LookCluster />
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
        {viewMode === 'outline' && (
          <button
            type="button"
            title={showSceneObjects ? 'Hide scene objects' : 'Show scene objects'}
            aria-pressed={showSceneObjects}
            onClick={() => toggleShowSceneObjects()}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              showSceneObjects
                ? 'text-ink-dim hover:bg-panel-3 hover:text-ink'
                : 'bg-panel-3 text-ink'
            }`}
          >
            {showSceneObjects ? <EyeIcon size={13} /> : <EyeOffIcon size={13} />}
          </button>
        )}
      </div>

      {center && <div className="pointer-events-auto shrink-0">{center}</div>}

      <div className="pointer-events-auto flex min-w-0 flex-1 items-center justify-end gap-2">
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
        <button
          type="button"
          title="Keyboard shortcuts (?)"
          onClick={() => useEditorStore.getState().toggleShortcuts()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-panel/90 text-[12px] text-ink-dim shadow-lg backdrop-blur hover:bg-panel-2 hover:text-ink"
        >
          ?
        </button>
      </div>
    </div>
  )
}
