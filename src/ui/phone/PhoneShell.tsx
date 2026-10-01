import { useEffect, useRef, type ReactNode } from 'react'
import { useEditorStore, type TaskPanel, type WorkspaceMode } from '../../state/useEditorStore'
import { useProjectStore } from '../../state/useProjectStore'
import { usePathStore } from '../../state/usePathStore'
import { useCameraReady } from '../../state/cameraPathLink'
import { finishPen } from '../../lib/finishPen'
import { isTutorialProgressV2 } from '../../lib/tutorial/tutorialProgress'
import { ModeSwitcher } from '../ModeSwitcher'
import { LeftPanel, ProjectMenu } from '../LeftPanel'
import { DirectorDock } from '../DirectorDock'
import { Toolbar } from '../Toolbar'
import { AddObjectDrawer } from '../AddObjectDrawer'
import { ComposeDock } from '../composeDock/ComposeDock'
import { PhoneObjectAnimator } from './PhoneObjectAnimator'
import { VisualizeBar } from '../visualize/VisualizeBar'
import { ClockIcon, CubeIcon, ListIcon, WandIcon } from '../icons'
import { GUTTER, PHONE_TASK_BAR_HEIGHT, PHONE_TOP_BAR_HEIGHT } from '../viewportInsets'
import { useSafeAreaInsets, type SafeAreaInsets } from '../safeAreaInsets'

/**
 * Phone editor shell (issue #66). A full-bleed 3D canvas sits behind a slim top
 * app bar (project menu + workspace switcher) and a bottom task bar that opens
 * exactly one Task panel at a time in a bottom sheet. The lesson can open its
 * Compose timeline and Visualize review controls as task sheets; deeper touch
 * workspace polish continues with the responsive UI work.
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
const ADD_BUTTON: TaskButton = { panel: 'tools', label: 'Add', icon: <CubeIcon /> }
const TIMELINE_BUTTON: TaskButton = { panel: 'timeline', label: 'Timeline', icon: <ClockIcon /> }
const ANIMATE_BUTTON: TaskButton = { panel: 'timeline', label: 'Animate', icon: <ClockIcon /> }
const directorButton = (mode: WorkspaceMode): TaskButton => ({
  panel: 'director',
  label: mode === 'visualize' ? 'Visualize' : 'Director',
  icon: <WandIcon />,
})

/** Task bar buttons per workspace. Visualize has no scene-editing tools. */
function taskButtons(mode: WorkspaceMode): TaskButton[] {
  if (mode === 'visualize') return [SCENE_BUTTON, directorButton(mode)]
  if (mode === 'compose') return [SCENE_BUTTON, ADD_BUTTON, TIMELINE_BUTTON, directorButton(mode)]
  return [SCENE_BUTTON, ADD_BUTTON, ANIMATE_BUTTON, directorButton(mode)]
}

function tutorialTaskPanel(actionId: string): TaskPanel | null {
  switch (actionId) {
    case 'navigate.recover':
    case 'camera.select':
      return 'scene'
    case 'figure.add':
    case 'figure.place':
    case 'camera.path':
      return 'tools'
    case 'timing.duration':
      return 'timeline'
    case 'figure.pose':
    case 'room.scene-edit':
    case 'camera.height':
    case 'camera.frame':
    case 'timing.lens':
    case 'finish.review':
    case 'finish.export':
      return 'director'
    default:
      return null
  }
}

export function PhoneShell() {
  const active = useEditorStore((s) => s.activeTaskPanel)
  const setActive = useEditorStore((s) => s.setActiveTaskPanel)
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const cameraView = useEditorStore((s) => s.cameraView)
  const setCameraView = useEditorStore((s) => s.setCameraView)
  const cameraReady = useCameraReady()
  const safe = useSafeAreaInsets()
  const tutorialPanel = useProjectStore((s) => {
    const t = s.workflow.tutorial
    return isTutorialProgressV2(t) && t.active && !t.done
      ? tutorialTaskPanel(t.currentActionId)
      : null
  })
  const autoOpenedTutorialPanel = useRef<TaskPanel | null>(null)
  const panelBeforeCamera = useRef<TaskPanel | null>(null)

  const buttons = taskButtons(workspaceMode)
  const activeTitle = buttons.find((b) => b.panel === active)?.label ?? ''
  // A button hidden by a workspace switch must not leave a stale open panel.
  useEffect(() => {
    if (active !== 'none' && !buttons.some((b) => b.panel === active)) {
      setActive('none')
    }
  }, [active, buttons, setActive])

  useEffect(() => {
    const previous = autoOpenedTutorialPanel.current
    if (tutorialPanel && previous !== tutorialPanel) {
      autoOpenedTutorialPanel.current = tutorialPanel
      setActive(tutorialPanel)
    } else if (!tutorialPanel && previous) {
      autoOpenedTutorialPanel.current = null
      if (active === previous) setActive('none')
    }
  }, [active, setActive, tutorialPanel])

  const close = () => setActive('none')
  const enterCameraView = () => {
    panelBeforeCamera.current = active === 'none' ? null : active
    setActive('none')
    setCameraView(true)
  }
  const returnToEditor = () => {
    const panel = panelBeforeCamera.current
    panelBeforeCamera.current = null
    setCameraView(false)
    if (panel) setActive(panel)
  }
  const edges = barEdges(safe)

  return (
    <>
      {!cameraView && <div
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
      </div>}

      <TaskSheet
        active={active}
        title={activeTitle}
        onClose={close}
        onLookThrough={enterCameraView}
        cameraReady={cameraReady}
        safe={safe}
        workspaceMode={workspaceMode}
      />
      {!cameraView && <PhonePathFinishButton safe={safe} />}

      {cameraView ? (
        <button
          type="button"
          aria-label="Return to editor"
          onClick={returnToEditor}
          className="panel absolute z-50 flex items-center justify-center rounded-lg px-4 text-[12px] font-medium text-ink shadow-xl"
          style={{ bottom: safe.bottom + GUTTER, ...edges, height: PHONE_TASK_BAR_HEIGHT }}
        >
          Return to editor
        </button>
      ) : <div
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
      </div>}
    </>
  )
}

function PhonePathFinishButton({ safe }: { safe: SafeAreaInsets }) {
  const workspaceMode = useEditorStore((s) => s.workspaceMode)
  const tool = useEditorStore((s) => s.tool)
  const path = usePathStore((s) => s.paths.find((candidate) => candidate.id === s.activePathId))
  if (workspaceMode !== 'compose' || tool !== 'pen' || !path || path.closed || path.anchors.length < 2) return null

  return (
    <button
      type="button"
      data-tour="phone-finish-path"
      onClick={() => finishPen(false)}
      className="panel absolute left-1/2 z-[60] min-h-11 -translate-x-1/2 rounded-lg border border-accent/60 bg-accent px-4 text-[12px] font-medium text-white shadow-xl"
      style={{ bottom: safe.bottom + PHONE_TASK_BAR_HEIGHT + GUTTER }}
    >
      Finish path
    </button>
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
  onLookThrough,
  cameraReady,
  safe,
  workspaceMode,
}: {
  active: TaskPanel
  title: string
  onClose: () => void
  onLookThrough: () => void
  cameraReady: boolean
  safe: SafeAreaInsets
  workspaceMode: WorkspaceMode
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
        data-phone-task-sheet
        className="panel absolute flex flex-col overflow-hidden"
        style={{
          top: safe.top + PHONE_TOP_BAR_HEIGHT + GUTTER,
          ...barEdges(safe),
          bottom: safe.bottom + PHONE_TASK_BAR_HEIGHT + GUTTER + GUTTER,
        }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line/60 px-3 py-2">
          <span className="text-[12px] font-medium text-ink">{title}</span>
          <div className="flex items-center gap-1">
            {workspaceMode === 'compose' && cameraReady && (
              <button
                type="button"
                onClick={onLookThrough}
                className="min-h-11 rounded-md border border-line px-2.5 text-[11px] font-medium text-ink hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Look through
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-dim hover:bg-panel-2 hover:text-ink"
            >
              <span className="text-[13px]">✕</span>
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {render('scene', <LeftPanel variant="sheet" />)}
          {render(
            'tools',
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
              <div className="shrink-0 overflow-x-auto">
                <Toolbar phoneSheet />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <AddObjectDrawer variant="sheet" />
              </div>
            </div>,
          )}
          {render(
            'timeline',
            workspaceMode === 'build'
              ? <PhoneObjectAnimator />
              : <ComposeDock variant="sheet" />,
          )}
          {render('director', workspaceMode === 'visualize'
            ? <VisualizeBar variant="sheet" />
            : <DirectorDock variant="sheet" />)}
        </div>
      </div>
    </div>
  )
}
