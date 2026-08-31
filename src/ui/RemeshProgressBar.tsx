import { useEffect, useState } from 'react'
import { cancelMeshJob } from '../lib/meshJobs'
import { liveExpectedRemeshMs, remeshBarState } from '../lib/remeshEta'
import { useSceneStore } from '../state/useSceneStore'

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function RemeshProgressBar({
  progress,
  startedAt,
  now: nowProp,
}: {
  progress: number | null
  startedAt?: number
  now?: number
}) {
  const tick = useNow(250)
  const now = nowProp ?? tick
  const started = startedAt ?? now
  const state = remeshBarState({
    startedAt: started,
    now,
    expectedMs: liveExpectedRemeshMs(),
    falProgress: progress,
  })
  const percent = Math.round(state.fraction * 100)
  return (
    <div className="flex flex-col gap-1">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-panel-3"
        role="progressbar"
        aria-label="Remesh progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={state.label}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-[10px] tabular-nums text-ink-dim">{state.label}</p>
    </div>
  )
}

export function RemeshJobOverlay() {
  const importing = useSceneStore((s) => s.importing)
  const pendingLifts = useSceneStore((s) => s.pendingLifts)
  const sceneJob = pendingLifts.find((lift) => lift.kind === 'generate' && !lift.objectId)
  const remeshJobs = pendingLifts.filter((lift) => lift.kind === 'remesh')

  if (sceneJob) {
    return (
      <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55">
        <div className="panel w-[min(92vw,380px)] px-5 py-4">
          <p className="text-sm font-medium text-ink">{sceneJob.name}</p>
          <p className="mt-1 text-[11px] text-ink-dim">
            {/^Generating environment/i.test(sceneJob.name)
              ? 'TripoSplat is building the palco. You can cancel and try again.'
              : /Generating/i.test(sceneJob.name)
                ? 'Clay mesh from Fal. This can take a minute. The result lands in Unplaced.'
                : /^Remeshing /i.test(sceneJob.name)
                  ? 'Dense meshes remesh off-scene. The bar is a typical wait — cancel if it hangs.'
                  : 'Lifts stay off-scene until the batch is ready. You can cancel and try again.'}
          </p>
          <div className="mt-3">
            <RemeshProgressBar progress={sceneJob.progress} startedAt={sceneJob.startedAt} />
          </div>
          <button
            type="button"
            className="mt-3 rounded bg-panel-2 px-3 py-1.5 text-[11px] text-ink hover:bg-panel-3"
            onClick={() => cancelMeshJob(sceneJob.id)}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (remeshJobs.length === 0) return null
  return (
    <div
      className={`panel absolute left-1/2 z-30 w-[min(92vw,360px)] -translate-x-1/2 px-4 py-3 ${
        importing > 0 ? 'top-40' : 'top-28'
      }`}
    >
      <div className="flex flex-col gap-3">
        {remeshJobs.map((job) => (
          <div key={job.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-ink">{job.name}</span>
              <button
                type="button"
                className="shrink-0 text-[10px] text-ink-dim hover:text-ink"
                onClick={() => cancelMeshJob(job.id)}
                title="Cancel remesh and keep the original high mesh"
              >
                Keep high mesh
              </button>
            </div>
            <div className="mt-2">
              <RemeshProgressBar progress={job.progress} startedAt={job.startedAt} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
