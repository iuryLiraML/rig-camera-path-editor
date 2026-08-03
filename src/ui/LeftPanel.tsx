import { useEffect, useRef, useState } from 'react'
import { useEditorStore, type SelectableId } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { openImportDialog, resetScene } from '../lib/sceneIO'
import { createProject, deleteProject, switchProject } from '../lib/projects'
import { useProjectStore } from '../state/useProjectStore'
import { useRigStore } from '../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore, selectCameraAnchorCount } from '../state/usePathStore'
import { useCameraOptionsStore } from '../state/useCameraOptionsStore'
import { generateRacingDroneCameras } from '../lib/cameraBatch/generateRacingDroneCameras'
import {
  BookIcon,
  CameraIcon,
  CubeIcon,
  HelpIcon,
  ImportIcon,
  MenuIcon,
  PenIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
  TargetIcon,
  TrashIcon,
} from './icons'

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
  const selected = selection === id
  return (
    <button
      onClick={() => select(selected ? null : id)}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
        selected ? 'bg-accent text-white' : 'text-ink hover:bg-panel-2'
      }`}
    >
      <span className={selected ? 'text-white' : 'text-ink-dim'}>{icon}</span>
      <span className="truncate">{name}</span>
    </button>
  )
}

/** A motion path in the tree — selecting it makes it the active/editable path. */
function PathTreeItem({ id, name }: { id: string; name: string }) {
  const selection = useEditorStore((s) => s.selection)
  const activePathId = usePathStore((s) => s.activePathId)
  const selected = selection === 'camera-path' && activePathId === id
  return (
    <button
      onClick={() => {
        if (selected) {
          useEditorStore.getState().select(null)
          return
        }
        usePathStore.getState().setActivePath(id)
        useEditorStore.getState().select('camera-path')
      }}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
        selected ? 'bg-accent text-white' : 'text-ink hover:bg-panel-2'
      }`}
    >
      <span className={selected ? 'text-white' : 'text-ink-dim'}>
        <PenIcon />
      </span>
      <span className="truncate">{name}</span>
    </button>
  )
}

function CameraOptionItem({ id, name }: { id: string; name: string }) {
  const activeOptionId = useCameraOptionsStore((s) => s.activeOptionId)
  const canRemove = useCameraOptionsStore((s) => s.options.length > 1)
  const selection = useEditorStore((s) => s.selection)
  const active = id === activeOptionId
  const selected = active && selection === 'cinema-camera'
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
          <span className="truncate">{name}</span>
        )}
      </button>
{/* This was a 10px "x" at opacity-0 until you hovered the exact row, which
          read as "cameras cannot be deleted". Always visible, real icon, and it
          asks once before throwing away a camera move. */}
      {canRemove &&
        (confirming ? (
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
        ))}
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

function ProjectMenu() {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<'reset' | 'delete' | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const projectId = useProjectStore((s) => s.projectId)
  const projectList = useProjectStore((s) => s.projectList)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false)
        setConfirming(null)
      }
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const item = 'w-full rounded-md px-2 py-1.5 text-left text-[11px] text-ink hover:bg-panel-2'
  const closeMenu = () => {
    setOpen(false)
    setConfirming(null)
  }

  return (
    <div ref={ref} className="relative">
      <button
        className={open ? 'text-ink' : 'text-ink-dim hover:text-ink'}
        title="Project menu"
        onClick={() => {
          setOpen((v) => !v)
          setConfirming(null)
        }}
      >
        <MenuIcon />
      </button>
      {open && (
        <div className="panel absolute left-0 top-7 z-30 w-52 p-1">
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
              void createProject().catch(() =>
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
        </div>
      )}
    </div>
  )
}

function ProjectNameInput() {
  const name = useProjectStore((s) => s.name)
  return (
    <input
      value={name}
      onChange={(e) => useProjectStore.getState().setName(e.target.value)}
      className="w-full min-w-0 truncate bg-transparent text-xs font-medium text-ink outline-none"
      title="Project name"
    />
  )
}

export function LeftPanel() {
  const objects = useSceneStore((s) => s.objects)
  const hasPath = usePathStore(selectCameraAnchorCount) > 0
  const paths = usePathStore((s) => s.paths)
  const lookAtMode = useRigStore((s) => s.lookAtMode)
  const cameraOptions = useCameraOptionsStore((s) => s.options)
  const [query, setQuery] = useState('')

  const items: { id: SelectableId; icon: React.ReactNode; name: string }[] = [
    ...objects.map((o) => ({
      id: `obj:${o.id}` as SelectableId,
      icon: <CubeIcon />,
      name: o.name,
    })),
    { id: 'light', icon: <SunIcon />, name: 'Directional Light' },
  ]
  if (hasPath && lookAtMode === 'target') {
    items.push({ id: 'target', icon: <TargetIcon />, name: 'Look-At Target' })
  }
  const q = query.toLowerCase()
  const visible = items.filter((i) => i.name.toLowerCase().includes(q))
  const visibleCameras = cameraOptions.filter((c) => c.name.toLowerCase().includes(q))
  const pathItems = paths
    .map((p) => ({ id: p.id, name: p.id === CAMERA_PATH_ID ? 'Camera Path' : p.name }))
    .filter((p) => p.name.toLowerCase().includes(q))

  return (
    <div className="panel absolute bottom-3 left-3 top-3 z-20 flex w-[232px] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-2.5">
        <ProjectNameInput />
        <ProjectMenu />
      </div>

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
        <div className="flex flex-col gap-0.5">
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
        {pathItems.length > 0 && (
          <div className="mt-3">
            <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-ink-dim">
              Paths
            </div>
            <div className="flex flex-col gap-0.5">
              {pathItems.map((p) => (
                <PathTreeItem key={p.id} id={p.id} name={p.name} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line/60 p-2">
        <FooterItem icon={<BookIcon />} label="Library" disabled />
        <FooterItem icon={<ImportIcon />} label="Import" onClick={openImportDialog} />
        <FooterItem icon={<HelpIcon />} label="Help" disabled />
      </div>
    </div>
  )
}
