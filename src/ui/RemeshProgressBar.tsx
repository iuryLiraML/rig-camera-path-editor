import { cancelMeshJob } from '../lib/meshJobs'
import { useSceneStore } from '../state/useSceneStore'

export function RemeshProgressBar({ progress }: { progress: number | null }) {
  const determinate = progress != null
  return (
    <div
      className="h-1 overflow-hidden rounded-full bg-panel-3"
      role="progressbar"
      aria-label="Remesh progress"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(determinate
        ? { 'aria-valuenow': Math.round(progress * 100) }
        : { 'aria-valuetext': 'In progress' })}
    >
      {determinate ? (
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      ) : (
        <div className="remesh-bar-indeterminate h-full w-1/3 rounded-full bg-accent" />
      )}
    </div>
  )
}

export function RemeshJobOverlay() {
  const importing = useSceneStore((s) => s.importing)
  const pendingLifts = useSceneStore((s) => s.pendingLifts)
  const jobs = pendingLifts.filter((lift) => lift.kind === 'remesh')
  if (jobs.length === 0) return null
  return (
    <div
      className={`panel absolute left-1/2 z-30 w-[min(92vw,360px)] -translate-x-1/2 px-4 py-3 ${
        importing > 0 ? 'top-40' : 'top-28'
      }`}
    >
      <div className="flex flex-col gap-3">
        {jobs.map((job) => (
          <div key={job.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-ink">{job.name}</span>
              <button
                type="button"
                className="shrink-0 text-[10px] text-ink-dim hover:text-ink"
                onClick={() => cancelMeshJob(job.id)}
              >
                Cancel
              </button>
            </div>
            <div className="mt-2">
              <RemeshProgressBar progress={job.progress} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
