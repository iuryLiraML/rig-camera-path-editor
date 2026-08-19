import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { ListIcon } from './icons'
import { useViewportInsets } from './viewportInsets'

export function ProjectChip() {
  const name = useProjectStore((s) => s.name)
  const showOutliner = useEditorStore((s) => s.showOutliner)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const insets = useViewportInsets()
  const canToggleOutliner = workspaceMode !== 'visualize'

  return (
    <div
      className="panel absolute top-3 z-40 flex max-w-[240px] items-center gap-1.5 px-2 py-1"
      style={{ left: insets.left }}
    >
      {canToggleOutliner && (
        <>
          <button
            type="button"
            title="Outliner"
            onClick={() => useEditorStore.getState().toggleOutliner()}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
              showOutliner ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
            }`}
          >
            <ListIcon size={14} />
          </button>
          <span className="h-3 w-px bg-line/70" />
        </>
      )}
      <button
        type="button"
        title="Back to projects"
        onClick={() => useEditorStore.getState().setAppView('projects')}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-ink-dim hover:bg-panel-2 hover:text-ink"
      >
        Projects
      </button>
      <span className="h-3 w-px bg-line/70" />
      <input
        value={name}
        onChange={(e) => useProjectStore.getState().setName(e.target.value)}
        className="min-w-0 flex-1 truncate bg-transparent text-[11px] font-medium text-ink outline-none"
        title="Project name"
      />
    </div>
  )
}
