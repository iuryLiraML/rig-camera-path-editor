import type { ReactNode } from 'react'
import { useEditorStore } from '../state/useEditorStore'
import { useCameraAnchorCount } from '../state/cameraPathLink'
import { useSceneStore } from '../state/useSceneStore'
import { PenIcon, PlusIcon } from './icons'
import { chromeBand, useWindowSize, useViewportInsets } from './viewportInsets'

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
        body="Add a primitive or import a .glb, then switch to Compose."
        actionLabel="Add an object"
        onAction={() => useSceneStore.getState().dismissOnboarding()}
        icon={<PlusIcon />}
      />
    )
  }

  if (mode === 'visualize') {
    return (
      <Guide
        title="Describe the shot"
        body="Open Director, describe the shot, then send. Edit Shot returns to Compose."
        actionLabel="Open Settings"
        onAction={() => useEditorStore.getState().setShowSettings(true)}
      />
    )
  }

  if (anchors >= 2 || tool === 'pen' || tool === 'draw') return null

  const onePoint = anchors === 1
  return (
    <Guide
      title={onePoint ? 'Add one more point to play and export' : 'Frame a camera fly-through'}
      body={
        onePoint
          ? 'Playback and export need two points. Click Pen and add the next one.'
          : 'Draw a path with Pen, pick a preset, or generate one in Visualize. Then Add a Shot.'
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
  const win = useWindowSize()
  const band = chromeBand(insets, win.w)
  return (
    <div
      className="panel absolute z-20 -translate-x-1/2 p-2.5"
      style={{ bottom: insets.contentBottom, left: band.left + band.width / 2, width: Math.min(340, band.width) }}
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
      <p className="mt-1.5 text-[12px] leading-snug text-ink-dim">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink hover:text-accent"
      >
        {icon}
        {actionLabel}
      </button>
    </div>
  )
}
