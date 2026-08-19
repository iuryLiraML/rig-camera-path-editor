import { useEditorStore, type CameraPanel } from '../state/useEditorStore'
import { CinemaCameraSections } from './RightPanel'
import { LEFT_PANEL_MAX, useViewportInsets } from './viewportInsets'

const TABS: { value: Exclude<CameraPanel, 'closed'>; label: string }[] = [
  { value: 'adjust', label: 'Adjust' },
  { value: 'fx', label: 'FX' },
]

/**
 * Floating camera inspector for Compose. Lives next to the outliner, not
 * inside the Scene / Cameras / Paths tree — that list is for picking, this
 * panel is for lens, look-at, duration and camera noise.
 */
export function CameraAdjustPanel() {
  const tab = useEditorStore((s) => s.cameraPanel)
  const insets = useViewportInsets()

  if (tab === 'closed') return null

  return (
    <div
      className="panel absolute z-30 flex flex-col overflow-hidden"
      style={{
        left: insets.left,
        top: insets.top,
        width: LEFT_PANEL_MAX,
        bottom: insets.contentBottom,
      }}
    >
      <div className="flex items-center gap-1 border-b border-line/60 px-2 py-1.5">
        <span className="px-1 text-[11px] font-medium text-ink">Camera</span>
        <div className="flex items-center gap-0.5">
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => useEditorStore.getState().setCameraPanel(item.value)}
              className={`rounded-md px-2 py-1 text-[11px] ${
                tab === item.value ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          title="Close camera adjustments"
          onClick={() => useEditorStore.getState().setCameraPanel('closed')}
          className="ml-auto rounded-md px-1.5 py-0.5 text-[13px] text-ink-dim hover:text-ink"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <CinemaCameraSections pane={tab} />
      </div>
    </div>
  )
}
