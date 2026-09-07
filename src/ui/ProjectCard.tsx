import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FolderRecord } from '../lib/folders'
import type { ProjectSummary } from '../state/useProjectStore'
import {
  CHROME_MENU,
  CHROME_MENU_CAPTION,
  CHROME_MENU_ITEM,
  CHROME_MENU_WIDTH,
} from './chromeMenu'
import { ChevronDownIcon, DotsIcon } from './icons'

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

const MENU_WIDTH = 208

function menuCoords(button: HTMLElement) {
  const box = button.getBoundingClientRect()
  const left = Math.min(box.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)
  return { top: box.bottom + 6, left: Math.max(8, left) }
}

function sceneMenuCoords(button: HTMLElement) {
  const box = button.getBoundingClientRect()
  const left = Math.min(box.left, window.innerWidth - CHROME_MENU_WIDTH - 8)
  return { top: box.bottom + 6, left: Math.max(8, left) }
}

/**
 * Project tile. Thumbnail + title open the editor. The ⋯ menu (always on the
 * still) is how you rename, move, or delete — those actions used to live only
 * on the editor chip, so the home grid had no way to throw a project away.
 */
export function ProjectCard({
  project,
  active,
  busy,
  folders,
  onOpen,
  onOpenScene,
  onMove,
  onRename,
  onRenameScene,
  onDelete,
}: {
  project: ProjectSummary
  active: boolean
  busy: boolean
  folders: FolderRecord[]
  onOpen: () => void
  onOpenScene: (sceneId: string) => void
  onMove: (folderId: string | null) => void
  onRename: (name: string) => void
  onRenameScene: (sceneId: string, name: string) => void
  onDelete: () => void
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(project.name)
  const [renamingSceneId, setRenamingSceneId] = useState<string | null>(null)
  const [sceneDraft, setSceneDraft] = useState('')
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false)
  const [sceneCoords, setSceneCoords] = useState({ top: 0, left: 0 })
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const sceneBtnRef = useRef<HTMLButtonElement>(null)
  const sceneMenuRef = useRef<HTMLDivElement>(null)
  const openSceneTimer = useRef<number | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const sceneInputRef = useRef<HTMLInputElement>(null)
  const renamingRef = useRef(false)
  const renamingSceneIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!project.thumbnail) {
      setThumbUrl(null)
      return
    }
    const url = URL.createObjectURL(project.thumbnail)
    setThumbUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [project.thumbnail])

  useEffect(() => {
    if (!menuOpen) return
    const place = () => {
      const button = menuBtnRef.current
      if (button) setCoords(menuCoords(button))
    }
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuBtnRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setMenuOpen(false)
      setConfirmDelete(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', place)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!sceneMenuOpen) return
    const place = () => {
      const button = sceneBtnRef.current
      if (button) setSceneCoords(sceneMenuCoords(button))
    }
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (sceneBtnRef.current?.contains(target) || sceneMenuRef.current?.contains(target)) return
      setSceneMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', place)
    }
  }, [sceneMenuOpen])

  useEffect(() => {
    if (renaming) nameInputRef.current?.select()
  }, [renaming])

  useEffect(() => {
    if (renamingSceneId) sceneInputRef.current?.select()
  }, [renamingSceneId])

  useEffect(() => {
    return () => {
      if (openSceneTimer.current) window.clearTimeout(openSceneTimer.current)
    }
  }, [])

  const commitRename = () => {
    if (!renamingRef.current) return
    renamingRef.current = false
    setRenaming(false)
    const next = renameValue.trim()
    if (!next || next === project.name) {
      setRenameValue(project.name)
      return
    }
    onRename(next)
  }

  const startSceneRename = (id: string, currentName: string) => {
    if (openSceneTimer.current) {
      window.clearTimeout(openSceneTimer.current)
      openSceneTimer.current = null
    }
    setSceneMenuOpen(false)
    renamingSceneIdRef.current = id
    setRenamingSceneId(id)
    setSceneDraft(currentName)
  }

  const commitSceneRename = (id: string) => {
    if (renamingSceneIdRef.current !== id) return
    renamingSceneIdRef.current = null
    setRenamingSceneId(null)
    const next = sceneDraft.trim()
    if (!next) {
      setSceneDraft('')
      return
    }
    const current = project.scenes.find((scene) => scene.id === id)?.name
    if (next === current) return
    onRenameScene(id, next)
  }

  const item = 'w-full rounded-md px-2 py-1.5 text-left text-[12px] text-ink hover:bg-panel-2'

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-panel text-left transition-colors ${
        active ? 'border-accent/70' : 'border-line hover:border-ink-dim/50'
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
            <span className="absolute left-2.5 top-2.5 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-white">
              Active
            </span>
          )}
        </div>
      </button>
      <button
        ref={menuBtnRef}
        type="button"
        title="Project actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation()
          const button = menuBtnRef.current
          if (!menuOpen && button) setCoords(menuCoords(button))
          setMenuOpen((open) => !open)
          setConfirmDelete(false)
        }}
        className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/55 text-white shadow-lg backdrop-blur-sm hover:bg-black/75"
      >
        <DotsIcon size={14} />
      </button>
      <div className="flex items-start justify-between gap-3 px-3.5 pb-3 pt-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              ref={nameInputRef}
              autoFocus
              value={renameValue}
              aria-label="Project name"
              title="Project name"
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename()
                if (event.key === 'Escape') {
                  renamingRef.current = false
                  setRenameValue(project.name)
                  setRenaming(false)
                }
              }}
              className="w-full rounded-md border border-line bg-panel-2 px-1.5 py-0.5 text-sm font-medium text-ink outline-none"
            />
          ) : (
            <h3
              title="Project name"
              className="truncate text-sm font-medium text-ink"
              onDoubleClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                renamingRef.current = true
                setRenameValue(project.name)
                setRenaming(true)
              }}
            >
              {project.name || 'Untitled project'}
            </h3>
          )}
          <p className="mt-0.5 text-xs text-ink-dim">
            {project.scenes.length} {project.scenes.length === 1 ? 'scene' : 'scenes'} ·{' '}
            {project.objectCount !== undefined && <>{project.objectCount} {project.objectCount === 1 ? 'object' : 'objects'} · </>}
            {Boolean(project.pathCount) && <>{project.pathCount} {project.pathCount === 1 ? 'path' : 'paths'} · </>}
            {project.shotCount} {project.shotCount === 1 ? 'shot' : 'shots'} ·{' '}
            {relativeTime(project.updatedAt)}
          </p>
        </div>
      </div>
      {project.scenes.length > 0 && (
        <div className="border-t border-line/50 px-2 py-1.5">
          {renamingSceneId && renamingSceneId === (project.scenes[0]?.id ?? '') && !sceneMenuOpen ? (
            <input
              ref={sceneInputRef}
              value={sceneDraft}
              aria-label="Rename scene"
              title="Rename scene"
              onChange={(event) => setSceneDraft(event.target.value)}
              onBlur={() => commitSceneRename(renamingSceneId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && renamingSceneId) commitSceneRename(renamingSceneId)
                if (event.key === 'Escape') {
                  renamingSceneIdRef.current = null
                  setRenamingSceneId(null)
                }
              }}
              className="w-full rounded-md border border-line bg-panel-2 px-1.5 py-1 text-[11px] text-ink outline-none"
            />
          ) : (
            <button
              ref={sceneBtnRef}
              type="button"
              disabled={busy}
              title="Switch scene"
              aria-haspopup="menu"
              aria-expanded={sceneMenuOpen}
              onClick={(event) => {
                if (event.detail === 2) return
                const button = sceneBtnRef.current
                if (!sceneMenuOpen && button) setSceneCoords(sceneMenuCoords(button))
                setSceneMenuOpen((open) => !open)
              }}
              onDoubleClick={(event) => {
                event.preventDefault()
                const shown = project.scenes[0]
                if (!shown) return
                setSceneMenuOpen(false)
                startSceneRename(shown.id, shown.name)
              }}
              className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-[11px] text-ink-dim hover:bg-panel-2 hover:text-ink disabled:opacity-50"
            >
              <span className="min-w-0 truncate">{project.scenes[0]?.name}</span>
              <ChevronDownIcon size={12} className="shrink-0" />
            </button>
          )}
        </div>
      )}
      {sceneMenuOpen &&
        createPortal(
          <div
            ref={sceneMenuRef}
            role="menu"
            className={`${CHROME_MENU} fixed`}
            style={{ top: sceneCoords.top, left: sceneCoords.left, width: CHROME_MENU_WIDTH }}
          >
            <div className={CHROME_MENU_CAPTION}>Scenes</div>
            {project.scenes.map((scene) =>
              renamingSceneId === scene.id ? (
                <input
                  key={scene.id}
                  ref={sceneInputRef}
                  value={sceneDraft}
                  aria-label="Rename scene"
                  onChange={(event) => setSceneDraft(event.target.value)}
                  onBlur={() => commitSceneRename(scene.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitSceneRename(scene.id)
                    if (event.key === 'Escape') {
                      renamingSceneIdRef.current = null
                      setRenamingSceneId(null)
                    }
                  }}
                  className="w-full rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-[12px] text-ink outline-none"
                />
              ) : (
                <button
                  key={scene.id}
                  type="button"
                  role="menuitem"
                  title="Double-click to rename"
                  disabled={busy}
                  onClick={(event) => {
                    if (event.detail === 2) return
                    if (openSceneTimer.current) window.clearTimeout(openSceneTimer.current)
                    openSceneTimer.current = window.setTimeout(() => {
                      openSceneTimer.current = null
                      setSceneMenuOpen(false)
                      onOpenScene(scene.id)
                    }, 280)
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    startSceneRename(scene.id, scene.name)
                  }}
                  className={CHROME_MENU_ITEM}
                >
                  {scene.name}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
      {menuOpen &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="panel fixed z-50 w-52 p-1 shadow-xl"
            style={{ top: coords.top, left: coords.left }}
          >
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setMenuOpen(false)
                onOpen()
              }}
            >
              Open
            </button>
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setMenuOpen(false)
                setRenameValue(project.name)
                renamingRef.current = true
                setRenaming(true)
              }}
            >
              Rename
            </button>
            {folders.length > 0 && (
              <>
                <div className="my-1 h-px bg-line/60" />
                <div className="px-2 pb-1 pt-1.5 text-[10px] font-medium text-ink-dim">Move to</div>
                <button
                  type="button"
                  role="menuitem"
                  className={item}
                  onClick={() => {
                    setMenuOpen(false)
                    onMove(null)
                  }}
                >
                  Unfiled
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    role="menuitem"
                    className={item}
                    onClick={() => {
                      setMenuOpen(false)
                      onMove(folder.id)
                    }}
                  >
                    {folder.name}
                  </button>
                ))}
              </>
            )}
            <div className="my-1 h-px bg-line/60" />
            <button
              type="button"
              role="menuitem"
              className={`w-full rounded-md px-2 py-1.5 text-left text-[12px] ${
                confirmDelete ? 'bg-red-500/15 text-red-400' : 'text-red-400 hover:bg-red-500/10'
              }`}
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true)
                  return
                }
                setMenuOpen(false)
                setConfirmDelete(false)
                onDelete()
              }}
            >
              {confirmDelete ? 'Click again to delete' : 'Delete'}
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
