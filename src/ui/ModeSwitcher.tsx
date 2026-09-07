import { startTransition } from 'react'
import { useEditorStore, type WorkspaceMode } from '../state/useEditorStore'

const MODES: { value: WorkspaceMode; label: string; title: string }[] = [
  { value: 'build', label: 'Build', title: 'Place objects in the scene' },
  { value: 'compose', label: 'Compose', title: 'Frame shots and edit the camera' },
  { value: 'visualize', label: 'Visualize', title: 'Generate a reference from a prompt' },
]

export function ModeSwitcher() {
  const mode = useEditorStore((s) => s.workspaceMode)
  const setMode = useEditorStore((s) => s.setWorkspaceMode)

  return (
    <div className="panel flex shrink-0 items-center gap-0.5 px-1 py-1">
      {MODES.map((option) => {
        const active = mode === option.value
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            onClick={() => startTransition(() => setMode(option.value))}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] ${
              active ? 'bg-accent text-white' : 'text-ink-dim hover:text-ink'
            }`}
          >
            {/* The icon only repeated the label, and the row cannot spare the
                57px it cost at 1024 — the label carries the recognition. */}
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
