import type { ReactNode } from 'react'
import { useEditorStore } from '../state/useEditorStore'
import { useCameraAnchorCount } from '../state/cameraPathLink'
import { useSceneStore } from '../state/useSceneStore'
import { PenIcon, PlusIcon } from './icons'
import { useViewportInsets } from './viewportInsets'

/** First-run guide — copy depends on Build / Compose / Visualize. */
export function OnboardingCard() {
  const dismissed = useSceneStore((s) => s.onboardingDismissed)
  const anchors = useCameraAnchorCount()
  const objects = useSceneStore((s) => s.objects)
  const playMode = useEditorStore((s) => s.playMode)
  const tool = useEditorStore((s) => s.tool)
  const mode = useEditorStore((s) => s.workspaceMode)

  if (dismissed || playMode) return null

  if (mode === 'build') {
    if (objects.length > 0) return null
    return (
      <Guide
        title="Add something to look at"
        body="Import a .glb from the prompt bar or the Outliner, or press + to drop a clay primitive. Then switch to Compose to draw the camera."
        actionLabel="Add an object"
        onAction={() => useEditorStore.getState().setShowAddDrawer(true)}
        icon={<PlusIcon />}
      />
    )
  }

  if (mode === 'visualize') {
    return (
      <Guide
        title="Describe the shot"
        body="The Director builds the camera move from a prompt. Type in the bar at the bottom, then send. Edit Shot takes you back to Compose."
        actionLabel="Open Settings"
        onAction={() => useEditorStore.getState().setShowSettings(true)}
      />
    )
  }

  if (anchors >= 2 || tool === 'pen') return null

  const onePoint = anchors === 1
  return (
    <Guide
      title={onePoint ? 'Add one more point to play and export' : 'Frame a camera fly-through'}
      body={
        onePoint
          ? 'Playback and export need two points on the path. Click the Pen tool and add the next point.'
          : 'Draw a path with the Pen, pick a preset, or generate one in Visualize. Then press Add a Shot.'
      }
      actionLabel={onePoint ? 'Add the next point (P)' : 'Draw my own path (P)'}
      onAction={() => useEditorStore.getState().setTool('pen')}
      icon={<PenIcon />}
    />
  )
}

function Guide({
  title,
  body,
  actionLabel,
  onAction,
  icon,
}: {
  title: string
  body: string
  actionLabel: string
  onAction: () => void
  icon?: ReactNode
}) {
  const insets = useViewportInsets()
  return (
    <div
      className="panel absolute left-1/2 z-20 w-[420px] -translate-x-1/2 p-4"
      style={{ bottom: insets.contentBottom }}
    >
      <div className="flex items-start justify-between">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <button
          onClick={() => useSceneStore.getState().dismissOnboarding()}
          className="text-ink-dim hover:text-ink"
          title="Close"
        >
          ×
        </button>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-panel-2 px-2 py-2 text-[12px] text-ink hover:bg-panel-3"
      >
        {icon}
        {actionLabel}
      </button>
    </div>
  )
}
