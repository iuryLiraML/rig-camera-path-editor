import { useEditorStore, type WorkspaceMode } from '../state/useEditorStore'
import { CubeIcon, ClapperIcon, WandIcon } from './icons'
import { useViewportInsets } from './viewportInsets'

const MODES: { value: WorkspaceMode; label: string; icon: typeof WandIcon; title: string }[] = [
  { value: 'build', label: 'Build', icon: CubeIcon, title: 'Place objects in the scene' },
  { value: 'compose', label: 'Compose', icon: ClapperIcon, title: 'Frame shots and edit the camera' },
  { value: 'visualize', label: 'Visualize', icon: WandIcon, title: 'Generate a reference from a prompt' },
]

export function ModeSwitcher() {
  const mode = useEditorStore((s) => s.workspaceMode)
  const setMode = useEditorStore((s) => s.setWorkspaceMode)
  const insets = useViewportInsets()

  return (
    <div
      className="panel absolute top-3 z-40 flex -translate-x-1/2 items-center gap-0.5 px-1 py-1"
      style={{ left: insets.centre }}
    >
      {MODES.map((option) => {
        const Icon = option.icon
        const active = mode === option.value
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            onClick={() => setMode(option.value)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] ${
              active ? 'bg-accent text-white' : 'text-ink-dim hover:text-ink'
            }`}
          >
            <Icon size={13} />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
