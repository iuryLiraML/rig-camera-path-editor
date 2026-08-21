import { useSaveStatusStore } from '../lib/saveStatus'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { ListIcon } from './icons'
import { ProjectMenu } from './LeftPanel'
import { GUTTER, LEFT_PANEL_MAX } from './viewportInsets'

const SAVE_CHIP: Record<'saved' | 'saving' | 'dirty', { label: string; className: string }> = {
  saved: { label: 'Saved', className: 'text-ink-dim' },
  saving: { label: 'Saving…', className: 'text-ink-dim' },
  dirty: { label: 'Not saved', className: 'text-amber-400' },
}

export function ProjectChip() {
  const name = useProjectStore((s) => s.name)
  const showOutliner = useEditorStore((s) => s.showOutliner)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const saveStatus = useSaveStatusStore((s) => s.status)
  const canToggleOutliner = workspaceMode !== 'visualize'
  const chip = SAVE_CHIP[saveStatus]

  return (
    <div
      className={`panel absolute z-40 flex items-center gap-1.5 px-2 py-1 ${
        showOutliner ? 'rounded-b-none border-b-0' : 'max-w-[280px]'
      }`}
      style={{
        top: GUTTER,
        left: GUTTER,
        width: showOutliner ? LEFT_PANEL_MAX : undefined,
      }}
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
      <span
        data-save-status={saveStatus}
        className={`shrink-0 text-[10px] ${chip.className}`}
        title={chip.label}
      >
        {chip.label}
      </span>
      {showOutliner && (
        <>
          <ProjectMenu />
          <button
            type="button"
            title="Close outliner"
            onClick={() => useEditorStore.getState().setShowOutliner(false)}
            className="rounded-md px-1.5 py-0.5 text-[13px] text-ink-dim hover:bg-panel-2 hover:text-ink"
          >
            ×
          </button>
        </>
      )}
    </div>
  )
}
