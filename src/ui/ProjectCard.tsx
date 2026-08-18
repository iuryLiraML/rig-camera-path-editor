import { useEffect, useState } from 'react'
import type { FolderRecord } from '../lib/folders'
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
 * A project card. Leads with the first saved scene still, then lists scenes
 * so a folder of projects can open a specific version without the setup wizard.
 */
export function ProjectCard({
  project,
  active,
  busy,
  folders,
  onOpen,
  onOpenScene,
  onMove,
}: {
  project: ProjectSummary
  active: boolean
  busy: boolean
  folders: FolderRecord[]
  onOpen: () => void
  onOpenScene: (sceneId: string) => void
  onMove: (folderId: string | null) => void
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)

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
    <div
      className={`group flex flex-col overflow-hidden rounded-xl border bg-panel text-left transition-colors ${
        active ? 'border-accent/60' : 'border-line hover:border-ink-dim/60'
      }`}
    >
      <button
        type="button"
        disabled={busy}
        onClick={onOpen}
        title="Open this project in the editor"
        className="flex flex-col text-left disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-panel-2">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
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
        </div>
        <div className="flex items-baseline justify-between gap-3 px-3.5 pt-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-ink">
              {project.name || 'Untitled project'}
            </h3>
            <p className="mt-0.5 text-xs text-ink-dim">
              {project.shotCount} {project.shotCount === 1 ? 'scene' : 'scenes'} ·{' '}
              {relativeTime(project.updatedAt)}
            </p>
          </div>
          <span className="shrink-0 text-xs text-ink-dim opacity-0 transition-opacity group-hover:opacity-100">
            Open →
          </span>
        </div>
      </button>
      {project.scenes.length > 0 && (
        <ul className="mt-2 space-y-0.5 px-2 pb-1">
          {project.scenes.map((scene) => (
            <li key={scene.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onOpenScene(scene.id)}
                className="w-full truncate rounded-md px-1.5 py-1 text-left text-[11px] text-ink-dim hover:bg-panel-2 hover:text-ink disabled:opacity-50"
              >
                {scene.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {folders.length > 0 && (
        <label className="block px-3 pb-3 pt-1 text-[10px] text-ink-dim">
          Folder
          <select
            disabled={busy}
            value={project.folderId ?? ''}
            onChange={(event) => onMove(event.target.value || null)}
            className="mt-1 w-full rounded-md border border-line bg-panel-2 px-1.5 py-1 text-[11px] text-ink outline-none"
          >
            <option value="">Unfiled</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
