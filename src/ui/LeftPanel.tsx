import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCameraAnchorCount, useCameraFollowers } from '../state/cameraPathLink'
import { useEditorStore, type SelectableId } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { openImportDialog, resetScene } from '../lib/sceneIO'
import { cancelMeshJob } from '../lib/meshJobs'
import { RemeshProgressBar } from './RemeshProgressBar'
import { createProject, deleteProject, switchProject } from '../lib/projects'
import { useProjectStore } from '../state/useProjectStore'
import { useRigStore } from '../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { useCameraOptionsStore } from '../state/useCameraOptionsStore'
import { generateRacingDroneCameras } from '../lib/cameraBatch/generateRacingDroneCameras'
import { AddSceneMenu, addDrawnPath } from './AddSceneMenu'
import {
  CameraIcon,
  CubeIcon,
  EyeIcon,
  EyeOffIcon,
  ImportIcon,
  DotsIcon,
  PenIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
  TargetIcon,
  TrashIcon,
} from './icons'
import { GUTTER, TOP_ROW_HEIGHT, useViewportInsets } from './viewportInsets'

function VisibilityToggle({
  hideId,
  name,
  selected,
}: {
  hideId: string
  name: string
  selected?: boolean
}) {
  const hidden = useEditorStore((s) => s.hiddenIds.includes(hideId))
  return (
    <button
      type="button"
      title={hidden ? `Show ${name}` : `Hide ${name}`}
      aria-pressed={!hidden}
      onClick={(e) => {
        e.stopPropagation()
        useEditorStore.getState().toggleHidden(hideId)
      }}
      className={`shrink-0 rounded p-1 ${
        selected
          ? hidden
            ? 'text-white/45 hover:bg-white/15 hover:text-white'
            : 'text-white/70 hover:bg-white/15 hover:text-white'
          : hidden
            ? 'text-ink-dim/45 hover:bg-panel hover:text-ink'
            : 'text-ink-dim hover:bg-panel hover:text-ink'
      }`}
    >
      {hidden ? <EyeOffIcon size={12} /> : <EyeIcon size={12} />}
    </button>
  )
}

function TreeItem({
  id,
  icon,
  name,
}: {
  id: SelectableId
  icon: React.ReactNode
  name: string
}) {
  const selection = useEditorStore((s) => s.selection)
  const select = useEditorStore((s) => s.select)
  const hidden = useEditorStore((s) => s.hiddenIds.includes(id))
  const selected = selection === id
  return (
    <div
      className={`group flex w-full items-center gap-1 rounded-md pr-1 transition-colors ${
        selected ? 'bg-accent text-white' : 'text-ink hover:bg-panel-2'
      }`}
    >
      <button
        onClick={() => select(selected ? null : id)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
      >
        <span className={selected ? 'text-white' : 'text-ink-dim'}>{icon}</span>
        <span className={`truncate ${hidden ? 'opacity-45' : ''}`}>{name}</span>
      </button>
      <VisibilityToggle hideId={id} name={name} selected={selected} />
    </div>
  )
}

/** Scene objects (GLB, primitives) — same always-visible trash as cameras/paths. */
function ObjectTreeItem({
  id,
  icon,
  name,
}: {
  id: string
  icon: React.ReactNode
  name: string
}) {
  const selection = useEditorStore((s) => s.selection)
  const select = useEditorStore((s) => s.select)
  const remeshJob = useSceneStore((s) => s.pendingLifts.find((lift) => lift.objectId === id))
  const selectableId: SelectableId = `obj:${id}`
  const selected = selection === selectableId
  const hidden = useEditorStore((s) => s.hiddenIds.includes(selectableId))
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const cancel = setTimeout(() => setConfirming(false), 4000)
    return () => clearTimeout(cancel)
  }, [confirming])

  return (
    <div className="flex flex-col gap-0.5">
    <div
      className={`group flex w-full items-center gap-1 rounded-md pr-1 transition-colors ${
        selected ? 'bg-accent text-white' : 'text-ink hover:bg-panel-2'
      }`}
    >
      <button
        onClick={() => select(selected ? null : selectableId)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
      >
        {remeshJob ? (
          <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
        ) : (
          <span className={selected ? 'text-white' : 'text-ink-dim'}>{icon}</span>
        )}
        <span className={`truncate ${hidden ? 'opacity-45' : ''}`}>
          {remeshJob ? `${name} — Remeshing…` : name}
        </span>
      </button>
      <VisibilityToggle hideId={selectableId} name={name} selected={selected} />
      {remeshJob ? (
        <button
          type="button"
          title="Cancel remesh"
          onClick={(e) => {
            e.stopPropagation()
            cancelMeshJob(remeshJob.id)
          }}
          className={`shrink-0 rounded px-1.5 py-1 text-[10px] ${
            selected ? 'text-white/80 hover:bg-white/10' : 'text-ink-dim hover:bg-panel-3 hover:text-ink'
          }`}
        >
          Cancel
        </button>
      ) : confirming ? (
        <button
          onClick={(e) => {
            e.stopPropagation()
            useSceneStore.getState().removeObject(id)
            if (useEditorStore.getState().selection === selectableId) {
              useEditorStore.getState().select(null)
            }
            setConfirming(false)
          }}
          title={`Delete "${name}" for good`}
          className="shrink-0 rounded px-1.5 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/15"
        >
          Delete?
        </button>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setConfirming(true)
          }}
          title="Delete object"
          className={`shrink-0 rounded p-1 ${
            selected
              ? 'text-white/70 hover:bg-white/15 hover:text-white'
              : 'text-ink-dim hover:bg-panel hover:text-red-400'
          }`}
        >
          <TrashIcon size={12} />
        </button>
      )}
    </div>
    {remeshJob && (
      <div className="px-2 pb-1">
        <RemeshProgressBar progress={remeshJob.progress} />
      </div>
    )}
    </div>
  )
}

/** A motion path in the tree — selecting it makes it the active/editable path. */
function PathTreeItem({ id, name }: { id: string; name: string }) {
  const selection = useEditorStore((s) => s.selection)
  const activePathId = usePathStore((s) => s.activePathId)
  const pathCount = usePathStore((s) => s.paths.length)
  const followedBy = useCameraFollowers(id)
  const selected = selection === 'camera-path' && activePathId === id
  const hidden = useEditorStore((s) => s.hiddenIds.includes(`path:${id}`))
  const [confirming, setConfirming] = useState(false)

  /*
   * Paths had no remove control here at all — the only way to delete one was to
   * select it and use the right panel. Two cases refuse rather than hide: a path
   * a camera still follows (the camera would fall back silently and the move
   * would be gone) and the last remaining path (the camera's fallback).
   */
  const blocked =
    followedBy.length > 0
      ? 'In use by ' +
        followedBy.join(', ') +
        ' - point ' +
        (followedBy.length === 1 ? 'that camera' : 'those cameras') +
        ' at another path first'
      : pathCount <= 1
        ? 'The last path cannot be deleted'
        : null

  return (
    <div
      className={`group flex w-full items-center gap-1 rounded-md pr-1 transition-colors ${
        selected ? 'bg-accent text-white' : 'text-ink hover:bg-panel-2'
      }`}
    >
      <button
        onClick={() => {
          if (selected) {
            useEditorStore.getState().select(null)
            return
          }
          usePathStore.getState().setActivePath(id)
          useEditorStore.getState().select('camera-path')
        }}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
      >
        <span className={selected ? 'text-white' : 'text-ink-dim'}>
          <PenIcon />
        </span>
        <span className={`truncate ${hidden ? 'opacity-45' : ''}`}>{name}</span>
      </button>
      <VisibilityToggle hideId={`path:${id}`} name={name} selected={selected} />
      {confirming && !blocked ? (
        <button
          onClick={(e) => {
            e.stopPropagation()
            usePathStore.getState().removePath(id)
            setConfirming(false)
          }}
          title={'Delete "' + name + '" for good'}
          className="shrink-0 rounded px-1.5 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/15"
        >
          Delete?
        </button>
      ) : (
        <button
          disabled={!!blocked}
          onClick={(e) => {
            e.stopPropagation()
            setConfirming(true)
          }}
          title={blocked ?? 'Delete path'}
          className={`shrink-0 rounded p-1 ${
            blocked
              ? 'cursor-not-allowed text-ink-dim/35'
              : selected
                ? 'text-white/70 hover:bg-white/15 hover:text-white'
                : 'text-ink-dim hover:bg-panel hover:text-red-400'
          }`}
        >
          <TrashIcon size={12} />
        </button>
      )}
    </div>
  )
}

function CameraOptionItem({ id, name }: { id: string; name: string }) {
  const activeOptionId = useCameraOptionsStore((s) => s.activeOptionId)
  const canRemove = useCameraOptionsStore((s) => s.options.length > 1)
  const selection = useEditorStore((s) => s.selection)
  const active = id === activeOptionId
  const selected = active && selection === 'cinema-camera'
  const hidden = useEditorStore((s) => s.hiddenIds.includes(`cam:${id}`))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [confirming, setConfirming] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // drop the armed confirmation as soon as the pointer leaves the row
  useEffect(() => {
    if (!confirming) return
    const cancel = setTimeout(() => setConfirming(false), 4000)
    return () => clearTimeout(cancel)
  }, [confirming])

  useEffect(() => {
    setDraft(name)
  }, [name])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  return (
    <div
      className={`group flex w-full items-center gap-1 rounded-md px-1 py-0.5 ${
        selected ? 'bg-accent text-white' : active ? 'bg-panel-2 text-ink' : 'text-ink hover:bg-panel-2'
      }`}
    >
      <button
        onClick={() => {
          useCameraOptionsStore.getState().switchOption(id)
          useEditorStore.getState().select('cinema-camera')
        }}
        onDoubleClick={() => setEditing(true)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-xs"
        title={name}
      >
        <span className={selected ? 'text-white' : 'text-ink-dim'}>
          <CameraIcon />
        </span>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => {
              setEditing(false)
              useCameraOptionsStore.getState().renameOption(id, draft)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                setDraft(name)
                setEditing(false)
              }
            }}
            className={`w-full bg-transparent outline-none ${selected ? 'text-white' : 'text-ink'}`}
          />
        ) : (
          <span className={`truncate ${hidden ? 'opacity-45' : ''}`}>{name}</span>
        )}
      </button>
      <VisibilityToggle hideId={`cam:${id}`} name={name} selected={selected} />
{/* This was a 10px "x" at opacity-0 until you hovered the exact row, which
          read as "cameras cannot be deleted". Always visible, real icon, and it
          asks once before throwing away a camera move. */}
      {!canRemove ? (
        <button
          disabled
          title="The last camera cannot be deleted"
          className="shrink-0 cursor-not-allowed rounded p-1 text-ink-dim/35"
        >
          <TrashIcon size={12} />
        </button>
      ) : confirming ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              useCameraOptionsStore.getState().removeOption(id)
            }}
            className="shrink-0 rounded px-1.5 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/15"
            title={`Delete "${name}" for good`}
          >
            Delete?
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setConfirming(true)
            }}
            className={`shrink-0 rounded p-1 ${
              selected
                ? 'text-white/70 hover:bg-white/15 hover:text-white'
                : 'text-ink-dim hover:bg-panel hover:text-red-400'
            }`}
            title="Delete camera"
          >
            <TrashIcon size={12} />
          </button>
        )}
    </div>
  )
}

function FooterItem({
  icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
        disabled
          ? 'cursor-not-allowed text-ink-dim/50'
          : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

const PROJECT_MENU_WIDTH = 208

function menuCoords(button: HTMLElement) {
  const r = button.getBoundingClientRect()
  const left = Math.min(r.left, window.innerWidth - PROJECT_MENU_WIDTH - 8)
  return { top: r.bottom + 6, left: Math.max(8, left) }
}

export function ProjectMenu() {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<'reset' | 'delete' | null>(null)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const projectId = useProjectStore((s) => s.projectId)
  const projectList = useProjectStore((s) => s.projectList)

  useEffect(() => {
    if (!open) return
    const place = () => {
      const button = buttonRef.current
      if (button) setCoords(menuCoords(button))
    }
    const close = (e: PointerEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
      setConfirming(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', place)
    }
  }, [open])

  const item = 'w-full rounded-md px-2 py-1.5 text-left text-[11px] text-ink hover:bg-panel-2'
  const closeMenu = () => {
    setOpen(false)
    setConfirming(null)
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        className={open ? 'text-ink' : 'text-ink-dim hover:text-ink'}
        title="Project menu"
        onClick={() => {
          const button = buttonRef.current
          if (!open && button) setCoords(menuCoords(button))
          setOpen((v) => !v)
          setConfirming(null)
        }}
      >
        <DotsIcon size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="panel fixed z-50 w-52 p-1"
            style={{ top: coords.top, left: coords.left }}
          >
          {projectList.length > 1 && (
            <>
              <div className="px-2 pb-1 pt-1.5 text-[10px] font-medium text-ink-dim">Open project</div>
              {projectList.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    closeMenu()
                    void switchProject(p.id).catch(() =>
                      useSceneStore.getState().showNotice('Project could not be opened'),
                    )
                  }}
                  className={`${item} ${p.id === projectId ? 'text-accent' : ''}`}
                >
                  {p.name}
                </button>
              ))}
              <div className="my-1 h-px bg-line/60" />
            </>
          )}
          <button
            onClick={() => {
              closeMenu()
              void createProject()
                .then(() => {
                  const store = useProjectStore.getState()
                  store.setWorkflow({ ...store.workflow, legacyEditorAccess: true })
                  useEditorStore.getState().setAppView('editor')
                })
                .catch(() =>
                  useSceneStore.getState().showNotice('Project could not be created'),
                )
            }}
            className={item}
          >
            New project
          </button>
          <button
            onClick={() => {
              if (confirming !== 'reset') {
                setConfirming('reset')
                return
              }
              closeMenu()
              void resetScene()
            }}
            className={`w-full rounded-md px-2 py-1.5 text-left text-[11px] ${
              confirming === 'reset' ? 'bg-red-500/15 text-red-400' : 'text-ink hover:bg-panel-2'
            }`}
          >
            {confirming === 'reset' ? 'Erase scene + path? Click to confirm' : 'Reset scene'}
          </button>
          <button
            onClick={() => {
              if (confirming !== 'delete') {
                setConfirming('delete')
                return
              }
              closeMenu()
              void deleteProject(projectId).catch(() =>
                useSceneStore.getState().showNotice('Project could not be deleted'),
              )
            }}
            className={`w-full rounded-md px-2 py-1.5 text-left text-[11px] ${
              confirming === 'delete' ? 'bg-red-500/15 text-red-400' : 'text-ink hover:bg-panel-2'
            }`}
          >
            {confirming === 'delete' ? 'Delete this project? Click to confirm' : 'Delete project'}
          </button>
          <div className="my-1 h-px bg-line/60" />
          <button
            onClick={() => {
              closeMenu()
              useEditorStore.getState().setShowSettings(true)
            }}
            className={item}
          >
            Settings…
          </button>
          </div>,
          document.body,
        )}
    </div>
  )
}

export function LeftPanel() {
  const objects = useSceneStore((s) => s.objects)
  const pendingLifts = useSceneStore((s) => s.pendingLifts)
  const hasPath = useCameraAnchorCount() > 0
  const paths = usePathStore((s) => s.paths)
  const lookAtMode = useRigStore((s) => s.lookAtMode)
  const cameraOptions = useCameraOptionsStore((s) => s.options)
  const [query, setQuery] = useState('')
  const insets = useViewportInsets()

  const items: { id: SelectableId; icon: React.ReactNode; name: string }[] = [
    { id: 'light', icon: <SunIcon />, name: 'Directional Light' },
  ]
  if (hasPath && lookAtMode === 'target') {
    items.push({ id: 'target', icon: <TargetIcon />, name: 'Look-At Target' })
  }
  const q = query.toLowerCase()
  const visibleObjects = objects.filter((o) => o.name.toLowerCase().includes(q))
  const visible = items.filter((i) => i.name.toLowerCase().includes(q))
  const visibleCameras = cameraOptions.filter((c) => c.name.toLowerCase().includes(q))
  const pathItems = paths
    .map((p) => ({ id: p.id, name: p.id === CAMERA_PATH_ID ? 'Camera Path' : p.name }))
    .filter((p) => p.name.toLowerCase().includes(q))

  return (
    <div
      className="panel absolute z-20 flex flex-col overflow-hidden rounded-t-none border-t-0"
      style={{
        left: GUTTER,
        top: GUTTER + TOP_ROW_HEIGHT,
        bottom: GUTTER,
        width: insets.leftWidth || 280,
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="px-2 pt-2">
        <div className="flex items-center gap-2 rounded-md bg-panel-2 px-2 py-1.5">
          <SearchIcon className="shrink-0 text-ink-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-ink-dim"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-ink-dim">
            Scene
          </span>
          <AddSceneMenu compact title="Add a shape or import a model" />
        </div>
        <div className="flex flex-col gap-0.5">
          {pendingLifts
            .filter((lift) => !lift.objectId)
            .map((lift) => (
            <div
              key={lift.id}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink-dim"
            >
              <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
              <span className="min-w-0 flex-1 truncate">{lift.name}</span>
              {(lift.kind === 'generate' || lift.kind === 'remesh') && (
                <button
                  type="button"
                  title="Cancel"
                  onClick={() => cancelMeshJob(lift.id)}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-ink-dim hover:bg-panel-3 hover:text-ink"
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
          {visibleObjects.map((object) => (
            <ObjectTreeItem
              key={object.id}
              id={object.id}
              icon={<CubeIcon />}
              name={object.name}
            />
          ))}
          {visible.map((item) => (
            <TreeItem key={item.id} {...item} />
          ))}
        </div>
        {visibleCameras.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-ink-dim">
                Cameras
              </span>
              <div className="flex items-center gap-0.5">
                {import.meta.env.DEV && (
                  <button
                    onClick={() => generateRacingDroneCameras(10, 10)}
                    className="rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-ink-dim hover:bg-panel-2 hover:text-ink"
                    title="Generate 10 racing-drone cameras (10s, high speed)"
                  >
                    RD×10
                  </button>
                )}
                <button
                  onClick={() => {
                    useCameraOptionsStore.getState().createOption()
                    useEditorStore.getState().select('cinema-camera')
                  }}
                  className="rounded p-0.5 text-ink-dim hover:bg-panel-2 hover:text-ink"
                  title="Duplicate active camera"
                >
                  <PlusIcon size={12} />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              {visibleCameras.map((camera) => (
                <CameraOptionItem key={camera.id} id={camera.id} name={camera.name} />
              ))}
            </div>
          </div>
        )}
        <div className="mt-3">
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-ink-dim">
                Paths
              </span>
              <button
                type="button"
                onClick={addDrawnPath}
                className="rounded p-0.5 text-ink-dim hover:bg-panel-2 hover:text-ink"
                title="Add a path"
              >
                <PlusIcon size={12} />
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              {pathItems.map((p) => (
                <PathTreeItem key={p.id} id={p.id} name={p.name} />
              ))}
            </div>
          </div>
      </div>

      <div className="border-t border-line/60 p-2">
        <FooterItem icon={<ImportIcon />} label="Import" onClick={openImportDialog} />
      </div>
      </div>
    </div>
  )
}
