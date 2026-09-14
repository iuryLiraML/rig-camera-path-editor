import { useEffect, useRef, type ReactNode } from 'react'
import { useEditorStore, type TaskPanel, type WorkspaceMode } from '../../state/useEditorStore'
import { ModeSwitcher } from '../ModeSwitcher'
import { LeftPanel, ProjectMenu } from '../LeftPanel'
import { DirectorDock } from '../DirectorDock'
import { Toolbar } from '../Toolbar'
import { CursorIcon, ListIcon, WandIcon } from '../icons'
import { GUTTER, PHONE_TASK_BAR_HEIGHT, PHONE_TOP_BAR_HEIGHT } from '../viewportInsets'
import { useSafeAreaInsets, type SafeAreaInsets } from '../safeAreaInsets'

/**
 * Phone editor shell (issue #66). A full-bleed 3D canvas sits behind a slim top
 * app bar (project menu + workspace switcher) and a bottom task bar that opens
 * exactly one Task panel at a time in a bottom sheet. This is the foundation:
 * per-workspace surfaces (timeline, camera, review) and touch-tool polish arrive
 * in #70 / #71 / #72.
 */

/** Height of the top app bar's inner content, centred in its band. */
const TOP_BAR_CONTENT_HEIGHT = 30

/** Horizontal edges for a phone bar or sheet, inset past the safe area. */
function barEdges(safe: SafeAreaInsets): { left: number; right: number } {
  return { left: safe.left + GUTTER, right: safe.right + GUTTER }
}

interface TaskButton {
  panel: Exclude<TaskPanel, 'none'>
  label: string
  icon: ReactNode
}

const SCENE_BUTTON: TaskButton = { panel: 'scene', label: 'Scene', icon: <ListIcon /> }
const TOOLS_BUTTON: TaskButton = { panel: 'tools', label: 'Tools', icon: <CursorIcon /> }
const directorButton = (mode: WorkspaceMode): TaskButton => ({
  panel: 'director',
  label: mode === 'visualize' ? 'Visualize' : 'Director',
  icon: <WandIcon />,
})

/** Task bar buttons per workspace. Visualize has no scene-editing tools. */
function taskButtons(mode: WorkspaceMode): TaskButton[] {
  return mode === 'visualize'
    ? [SCENE_BUTTON, directorButton(mode)]
    : [SCENE_BUTTON, TOOLS_BUTTON, directorButton(mode)]
}

export function PhoneShell() {
  const active = useEditorStore((s) => s.activeTaskPanel)
  const setActive = useEditorStore((s) => s.setActiveTaskPanel)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const safe = useSafeAreaInsets()

  const buttons = taskButtons(workspaceMode)
  const activeTitle = buttons.find((b) => b.panel === active)?.label ?? ''
  // A button hidden by a workspace switch must not leave a stale open panel.
  useEffect(() => {
    if (active !== 'none' && !buttons.some((b) => b.panel === active)) {
      setActive('none')
    }
  }, [active, buttons, setActive])

  const close = () => setActive('none')
  const edges = barEdges(safe)

  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 z-50 flex items-center gap-2"
        style={{
          top: safe.top + (PHONE_TOP_BAR_HEIGHT - TOP_BAR_CONTENT_HEIGHT) / 2,
          ...edges,
          height: TOP_BAR_CONTENT_HEIGHT,
        }}
      >
        <div className="panel pointer-events-auto flex items-center px-1 py-1">
          <ProjectMenu />
        </div>
        <div className="pointer-events-auto min-w-0">
          <ModeSwitcher />
        </div>
      </div>

      <TaskSheet active={active} title={activeTitle} onClose={close} safe={safe} />

      <div
        className="panel absolute z-50 flex items-stretch justify-around gap-1 px-2"
        style={{
          bottom: safe.bottom + GUTTER,
          ...edges,
          height: PHONE_TASK_BAR_HEIGHT,
        }}
      >
        {buttons.map((button) => {
          const on = active === button.panel
          return (
            <button
              key={button.panel}
              type="button"
              aria-pressed={on}
              onClick={() => setActive(on ? 'none' : button.panel)}
              className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-[10px] ${
                on ? 'bg-accent text-white' : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
              }`}
            >
              {button.icon}
              <span>{button.label}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

/**
 * The single Task sheet. Kept mounted (hidden) once opened so unsaved input —
 * the Director draft, the outliner search — survives closing and re-opening the
 * sheet and survives rotation within the phone tier. The scrim blocks editing
 * behind it, as intended for a task overlay, and taps dismiss it.
 */
function TaskSheet({
  active,
  title,
  onClose,
  safe,
}: {
  active: TaskPanel
  title: string
  onClose: () => void
  safe: SafeAreaInsets
}) {
  const open = active !== 'none'
  // Lazily mount each panel the first time it is opened, then keep it mounted.
  const seen = useRef<Set<TaskPanel>>(new Set())
  if (open) seen.current.add(active)

  const render = (panel: Exclude<TaskPanel, 'none'>, node: ReactNode) => {
    if (!seen.current.has(panel)) return null
    return (
      <div hidden={active !== panel} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {node}
      </div>
    )
  }

  return (
    <div hidden={!open} className="absolute inset-0 z-40">
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
      />
      <div
        className="panel absolute flex flex-col overflow-hidden"
        style={{
          top: safe.top + PHONE_TOP_BAR_HEIGHT + GUTTER,
          ...barEdges(safe),
          bottom: safe.bottom + PHONE_TASK_BAR_HEIGHT + GUTTER + GUTTER,
        }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line/60 px-3 py-2">
          <span className="text-[12px] font-medium text-ink">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink-dim hover:bg-panel-2 hover:text-ink"
          >
            <span className="text-[13px]">✕</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {render('scene', <LeftPanel variant="sheet" />)}
          {render(
            'tools',
            <div className="flex flex-wrap items-start gap-2 p-3">
              <Toolbar />
            </div>,
          )}
          {render('director', <DirectorDock variant="sheet" />)}
        </div>
      </div>
    </div>
  )
}
