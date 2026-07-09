import { useEditorStore, type Projection, type QuickView, type ViewMode } from '../state/useEditorStore'
import { usePathStore, selectCameraAnchorCount } from '../state/usePathStore'
import { leafList, useLayoutStore } from '../state/useLayoutStore'
import { TIMELINE_HEIGHT } from './Timeline'

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

export function ViewportFooter() {
  const projection = useEditorStore((s) => s.projection)
  const setProjection = useEditorStore((s) => s.setProjection)
  const requestView = useEditorStore((s) => s.requestView)
  const viewMode = useEditorStore((s) => s.viewMode)
  const setViewMode = useEditorStore((s) => s.setViewMode)
  const hasTimeline = usePathStore(selectCameraAnchorCount) >= 2
  const paneCount = useLayoutStore((s) => leafList(s.root).length)
  const activePaneId = useLayoutStore((s) => s.activePaneId)

  return (
    <div
      className="absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-2"
      style={{ bottom: hasTimeline ? TIMELINE_HEIGHT + 20 : 16 }}
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

      <div className="flex rounded-full bg-panel/90 p-0.5 shadow-lg backdrop-blur">
        {(
          [
            { value: 'orthographic', label: 'Orthographic' },
            { value: 'perspective', label: 'Perspective' },
          ] as { value: Projection; label: string }[]
        ).map((option) => (
          <button
            key={option.value}
            onClick={() => setProjection(option.value)}
            className={`rounded-full px-3 py-1 text-[11px] transition-colors ${
              projection === option.value
                ? 'bg-panel-3 text-ink'
                : 'text-ink-dim hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* split the viewport into panes (Blender-style); drag pane corners for more */}
      <div className="flex items-center rounded-full bg-panel/90 p-0.5 shadow-lg backdrop-blur">
        <button
          onClick={() => useLayoutStore.getState().splitPane(activePaneId, 'v')}
          title="Split the active pane left / right"
          className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:text-ink"
        >
          Split ▤
        </button>
        <button
          onClick={() => useLayoutStore.getState().splitPane(activePaneId, 'h')}
          title="Split the active pane top / bottom"
          className="rounded-full px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:text-ink"
        >
          ⊟
        </button>
        {paneCount > 1 && (
          <span className="px-2 text-[10px] text-ink-dim">{paneCount} panes</span>
        )}
      </div>
    </div>
  )
}
