import { useBatchStore } from '../state/useBatchStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore } from '../state/useProjectStore'
import { saveActiveProject } from '../lib/projects'

export function BatchGeneratePanel() {
  const workflow = useProjectStore((state) => state.workflow)
  const progress = useBatchStore((state) => state.progress)
  const running = useBatchStore((state) => state.running)
  const planned = workflow.shotList.shots
  const ready = workflow.intake.status === 'approved' && workflow.shotList.status === 'approved'

  if (!ready || planned.length === 0) return null

  const start = async () => {
    await useBatchStore.getState().startLocalBatch(planned)
    await saveActiveProject().catch(() => undefined)
    const final = useBatchStore.getState().progress
    if (final?.status === 'completed') {
      useEditorStore.getState().setAppView('board')
    }
  }

  const doneCount = progress?.shots.filter((shot) => shot.status === 'done').length ?? 0

  return (
    <div className="panel absolute bottom-24 left-3 z-30 w-[280px] p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
            Camera batch
          </p>
          <p className="mt-1 text-[11px] leading-5 text-ink-dim">
            Generate Board shots from the approved list ({planned.length} planned).
          </p>
        </div>
        {running ? (
          <button
            type="button"
            onClick={() => useBatchStore.getState().cancel()}
            className="rounded-md bg-panel-2 px-2 py-1 text-[10px] text-ink hover:bg-panel-3"
          >
            Cancel
          </button>
        ) : null}
      </div>

      {progress && (
        <div className="mt-3 space-y-1.5">
          <div className="flex justify-between text-[10px] text-ink-dim">
            <span>
              {progress.status === 'running'
                ? `Shot ${Math.min(progress.currentIndex + 1, progress.total)} / ${progress.total}`
                : progress.status}
            </span>
            <span>
              {doneCount}/{progress.total}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: `${progress.total === 0 ? 0 : (doneCount / progress.total) * 100}%`,
              }}
            />
          </div>
          {progress.cloudJobRunId && (
            <p className="truncate font-mono text-[9px] text-ink-dim">
              cloud:{progress.cloudJobRunId}
            </p>
          )}
          {progress.error && (
            <p role="alert" className="text-[10px] text-red-400">
              {progress.error}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={running}
        onClick={() => void start()}
        className="mt-3 w-full rounded-md bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/85 disabled:cursor-wait disabled:opacity-50"
      >
        {running
          ? 'Generating…'
          : progress?.status === 'completed'
            ? 'Regenerate batch'
            : 'Generate cameras'}
      </button>
      {progress?.status === 'completed' && (
        <button
          type="button"
          onClick={() => useEditorStore.getState().setAppView('board')}
          className="mt-2 w-full rounded-md bg-panel-2 px-3 py-1.5 text-[11px] text-ink hover:bg-panel-3"
        >
          Open Board
        </button>
      )}
    </div>
  )
}
