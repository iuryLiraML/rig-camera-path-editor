import { useEffect, useRef, useState } from 'react'
import { createScene, renameScene, switchScene } from '../lib/projects'
import { useProjectStore } from '../state/useProjectStore'

/** Switches which scene (a place within the project) is loaded on the stage. */
export function SceneSwitcher() {
  const sceneName = useProjectStore((s) => s.sceneName)
  const activeSceneId = useProjectStore((s) => s.activeSceneId)
  const scenes = useProjectStore((s) => s.scenes)
  const projectBusy = useProjectStore((s) => s.projectBusy)
  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
      setRenamingId(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  if (scenes.length === 0) return null

  const startRename = (id: string, name: string) => {
    setRenamingId(id)
    setRenameValue(name)
  }

  const commitRename = (id: string) => {
    setRenamingId(null)
    const next = renameValue.trim()
    if (next) void renameScene(id, next)
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        title="Switch scene"
        disabled={projectBusy}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-ink-dim hover:bg-panel-2 hover:text-ink disabled:cursor-wait disabled:opacity-50"
      >
        <span className="max-w-[56px] truncate">{sceneName}</span>
        <span className="text-[8px] leading-none">▾</span>
      </button>
      {open && (
        <div className="panel absolute left-0 top-full z-50 mt-1 w-48 p-1 shadow-xl" role="menu">
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {scenes.map((scene) => (
              <li key={scene.id}>
                {renamingId === scene.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={() => commitRename(scene.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename(scene.id)
                      if (event.key === 'Escape') setRenamingId(null)
                    }}
                    className="w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-[12px] text-ink outline-none"
                  />
                ) : (
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpen(false)
                        if (scene.id !== activeSceneId) void switchScene(scene.id)
                      }}
                      className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-panel-2 ${
                        scene.id === activeSceneId ? 'text-accent' : 'text-ink'
                      }`}
                    >
                      {scene.name}
                    </button>
                    <button
                      type="button"
                      title="Rename scene"
                      onClick={(event) => {
                        event.stopPropagation()
                        startRename(scene.id, scene.name)
                      }}
                      className="shrink-0 rounded-md p-1.5 text-[11px] text-ink-dim hover:bg-panel-2 hover:text-ink"
                    >
                      ✎
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="my-1 h-px bg-line/60" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void createScene()
            }}
            className="w-full rounded-md px-2 py-1.5 text-left text-[12px] text-ink-dim hover:bg-panel-2 hover:text-ink"
          >
            + New scene
          </button>
        </div>
      )}
    </div>
  )
}
