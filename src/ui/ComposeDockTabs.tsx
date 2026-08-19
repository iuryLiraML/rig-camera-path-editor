import { useEditorStore, type ComposeDock } from '../state/useEditorStore'

const TABS: { value: ComposeDock; label: string }[] = [
  { value: 'sequence', label: 'Sequence' },
  { value: 'timeline', label: 'Timeline' },
]

export function ComposeDockTabs() {
  const dock = useEditorStore((s) => s.composeDock)
  return (
    <div className="flex items-center gap-0.5">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => useEditorStore.getState().setComposeDock(tab.value)}
          className={`rounded-md px-2 py-1 text-[11px] ${
            dock === tab.value ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:text-ink'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
