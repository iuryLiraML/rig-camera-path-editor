import { useEditorStore, type CameraPanel } from '../state/useEditorStore'
import { CinemaCameraSections } from './RightPanel'

const TABS: { value: Exclude<CameraPanel, 'closed'>; label: string }[] = [
  { value: 'adjust', label: 'Adjust' },
  { value: 'fx', label: 'FX' },
]

/** Camera inspector embedded above the Director chat. */
export function CameraAdjustPanel() {
  const tab = useEditorStore((s) => s.cameraPanel)

  if (tab === 'closed') return null

  return (
    <div
      role="region"
      aria-label="Camera adjustments"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-line/60 px-2 py-1.5">
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
