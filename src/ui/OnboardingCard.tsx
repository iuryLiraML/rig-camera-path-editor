import { useEditorStore } from '../state/useEditorStore'
import { useCameraAnchorCount } from '../state/cameraPathLink'
import { useSceneStore } from '../state/useSceneStore'
import { PenIcon } from './icons'

/** First-run guide shown until the camera path has two points (playable). */
export function OnboardingCard() {
  const dismissed = useSceneStore((s) => s.onboardingDismissed)
  const anchors = useCameraAnchorCount()
  const playMode = useEditorStore((s) => s.playMode)
  const tool = useEditorStore((s) => s.tool)

  if (dismissed || anchors >= 2 || playMode || tool === 'pen') return null

  const onePoint = anchors === 1

  return (
    <div className="panel absolute bottom-16 left-1/2 z-20 w-[420px] -translate-x-1/2 p-4">
      <div className="flex items-start justify-between">
        <h2 className="text-sm font-semibold text-ink">
          {onePoint ? 'Add one more point to play and export' : 'Create a camera fly-through'}
        </h2>
        <button
          onClick={() => useSceneStore.getState().dismissOnboarding()}
          className="text-ink-dim hover:text-ink"
          title="Close"
        >
          ×
        </button>
      </div>

      {onePoint ? (
        <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
          Playback and export need two points on the path. Click the Pen tool and add the next
          point, or ask the Director on the right.
        </p>
      ) : (
        <ol className="mt-2 space-y-1 text-[12px] leading-relaxed text-ink-dim">
          <li>
            <span className="font-medium text-ink">1.</span> Drag a{' '}
            <span className="text-accent">.glb</span> file onto the canvas
          </li>
          <li>
            <span className="font-medium text-ink">2.</span> Draw a path with the Pen — or pick a
            preset on the timeline
          </li>
          <li>
            <span className="font-medium text-ink">3.</span> Press Play on the timeline, then tune
            the <span className="text-ink">Curve</span> dropdown. Or ask the Director on the right.
          </li>
        </ol>
      )}

      <button
        onClick={() => useEditorStore.getState().setTool('pen')}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-panel-2 px-2 py-2 text-[12px] text-ink hover:bg-panel-3"
      >
        <PenIcon />
        {onePoint ? 'Add the next point (P)' : 'Draw my own path (P)'}
      </button>
    </div>
  )
}
