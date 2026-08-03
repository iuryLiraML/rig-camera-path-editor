import { useEffect, useState } from 'react'
import type { ProjectSummary } from '../state/useProjectStore'

/** "2 hours ago" — a card needs recency at a glance, not a timestamp to parse */
export function relativeTime(from: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - from) / 1000))
  if (seconds < 60) return 'just now'
  const units: [number, string][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
    [2592000, 'month'],
    [31536000, 'year'],
  ]
  let last = units[0]
  for (const unit of units) {
    if (seconds < unit[0]) break
    last = unit
  }
  const n = Math.floor(seconds / last[0])
  return `${n} ${last[1]}${n === 1 ? '' : 's'} ago`
}

/**
 * A project card. The previous one was a title, a subtitle and an "Open
 * project" button over 8 units of dead space: nothing to recognise a project by
 * and nothing to sort it on. This leads with the first shot's still — the one
 * image that says what the project is — and makes the whole card the target.
 */
export function ProjectCard({
  project,
  active,
  busy,
  onOpen,
}: {
  project: ProjectSummary
  active: boolean
  busy: boolean
  onOpen: () => void
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const draft = project.setupStatus === 'draft'

  useEffect(() => {
    if (!project.thumbnail) {
      setThumbUrl(null)
      return
    }
    const url = URL.createObjectURL(project.thumbnail)
    setThumbUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [project.thumbnail])

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onOpen}
      title={draft ? 'Resume the guided setup' : 'Open this project in the editor'}
      className={`group flex flex-col overflow-hidden rounded-xl border bg-panel text-left transition-colors disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active ? 'border-accent/60' : 'border-line hover:border-ink-dim/60'
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-panel-2">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          // no shot saved yet: a neutral plate with the initial, so the grid
          // still reads as a grid of projects rather than a stack of text
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-panel-2 to-panel-3">
            <span className="text-2xl font-semibold text-ink-dim/50">
              {(project.name || 'U').trim().charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        {active && (
          <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-white">
            Active
          </span>
        )}
        {draft && (
          <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
            Setup draft
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-3 px-3.5 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-ink">
            {project.name || 'Untitled project'}
          </h3>
          <p className="mt-0.5 text-xs text-ink-dim">
            {project.shotCount} {project.shotCount === 1 ? 'shot' : 'shots'} ·{' '}
            {relativeTime(project.updatedAt)}
          </p>
        </div>
        <span className="shrink-0 text-xs text-ink-dim opacity-0 transition-opacity group-hover:opacity-100">
          {draft ? 'Resume' : 'Open'} →
        </span>
      </div>
    </button>
  )
}
