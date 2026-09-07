import { useEffect, useRef, useState } from 'react'
import { createScene, renameScene, switchScene } from '../lib/projects'
import { useProjectStore } from '../state/useProjectStore'
import {
  CHROME_MENU,
  CHROME_MENU_CAPTION,
  CHROME_MENU_ITEM,
  CHROME_MENU_ITEM_ACTIVE,
  CHROME_MENU_SEP,
} from './chromeMenu'

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
  const inputRef = useRef<HTMLInputElement>(null)
  const renamingIdRef = useRef<string | null>(null)

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

  useEffect(() => {
    if (renamingId) inputRef.current?.select()
  }, [renamingId])

  if (scenes.length === 0) return null

  const startRename = (id: string, name: string) => {
    renamingIdRef.current = id
    setRenamingId(id)
    setRenameValue(name)
  }

  const cancelRename = () => {
    renamingIdRef.current = null
    setRenamingId(null)
    setRenameValue('')
  }

  const commitRename = (id: string) => {
    if (!renamingIdRef.current) return
    renamingIdRef.current = null
    setRenamingId(null)
    const next = renameValue.trim()
    if (next) void renameScene(id, next)
  }

  const renamingOnChip = Boolean(renamingId && renamingId === activeSceneId && !open)

  return (
    <div ref={rootRef} className="relative shrink-0">
      {renamingOnChip ? (
        <input
          ref={inputRef}
          value={renameValue}
          aria-label="Rename scene"
          title="Rename scene"
          onChange={(event) => setRenameValue(event.target.value)}
          onBlur={() => {
            if (renamingId) commitRename(renamingId)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && renamingId) commitRename(renamingId)
            if (event.key === 'Escape') cancelRename()
          }}
          className="w-[8rem] rounded-md border border-line bg-panel-2 px-1.5 py-0.5 text-[11px] text-ink outline-none"
        />
      ) : (
        <button
          type="button"
          title="Switch scene"
          aria-expanded={open}
          disabled={projectBusy}
          onClick={(event) => {
            if (event.detail === 2) return
            setOpen((value) => !value)
          }}
          onDoubleClick={(event) => {
            event.preventDefault()
            if (projectBusy || !activeSceneId) return
            setOpen(false)
            startRename(activeSceneId, sceneName)
          }}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-dim hover:bg-panel-2 hover:text-ink disabled:cursor-wait disabled:opacity-50"
        >
          <span className="max-w-[8rem] truncate">{sceneName}</span>
          <span className="text-[8px] leading-none">▾</span>
        </button>
      )}
      {open && (
        <div className={`${CHROME_MENU} absolute left-0 top-full mt-1.5`} role="menu">
          <div className={CHROME_MENU_CAPTION}>Scenes</div>
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {scenes.map((scene) => (
              <li key={scene.id}>
                {renamingId === scene.id ? (
                  <input
                    ref={inputRef}
                    value={renameValue}
                    aria-label="Rename scene"
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={() => commitRename(scene.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename(scene.id)
                      if (event.key === 'Escape') cancelRename()
                    }}
                    className="w-full rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-[12px] text-ink outline-none"
                  />
                ) : (
                  <div className="group flex items-center gap-0.5">
                    <button
                      type="button"
                      role="menuitem"
                      title="Double-click to rename"
                      onClick={(event) => {
                        if (event.detail === 2) return
                        if (scene.id === activeSceneId) return
                        setOpen(false)
                        void switchScene(scene.id)
                      }}
                      onDoubleClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        if (projectBusy) return
                        startRename(scene.id, scene.name)
                      }}
                      className={`min-w-0 flex-1 truncate ${
                        scene.id === activeSceneId ? CHROME_MENU_ITEM_ACTIVE : CHROME_MENU_ITEM
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
                      className="shrink-0 rounded-lg p-2 text-[11px] text-ink-dim opacity-50 hover:bg-panel-2 hover:text-ink hover:opacity-100 group-hover:opacity-100"
                    >
                      ✎
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className={CHROME_MENU_SEP} />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void createScene()
            }}
            className={`${CHROME_MENU_ITEM} text-ink-dim`}
          >
            New scene
          </button>
        </div>
      )}
    </div>
  )
}
