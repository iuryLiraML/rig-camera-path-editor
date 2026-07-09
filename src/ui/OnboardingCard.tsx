import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'
import { usePathStore, selectCameraAnchorCount } from '../state/usePathStore'
import { applyCameraPreset, PRESETS } from '../lib/presets'
import { PenIcon } from './icons'

/** First-run guide shown while there is no camera path yet. */
export function OnboardingCard() {
  const dismissed = useSceneStore((s) => s.onboardingDismissed)
  const hasPath = usePathStore(selectCameraAnchorCount) > 0
  const playMode = useEditorStore((s) => s.playMode)
  const tool = useEditorStore((s) => s.tool)

  if (dismissed || hasPath || playMode || tool === 'pen') return null

  return (
    <div className="panel absolute bottom-16 left-1/2 z-20 w-[420px] -translate-x-1/2 p-4">
      <div className="flex items-start justify-between">
        <h2 className="text-sm font-semibold text-ink">Create a camera fly-through in 3 steps</h2>
        <button
          onClick={() => useSceneStore.getState().dismissOnboarding()}
          className="text-ink-dim hover:text-ink"
          title="Close"
        >
          ×
        </button>
      </div>

      <ol className="mt-2 space-y-1 text-[12px] leading-relaxed text-ink-dim">
        <li>
          <span className="font-medium text-ink">1.</span> Drag a{' '}
          <span className="text-accent">.glb</span> file onto the canvas (or use the sample model)
        </li>
        <li>
          <span className="font-medium text-ink">2.</span> Pick a ready-made path below — or draw
          your own
        </li>
        <li>
          <span className="font-medium text-ink">3.</span> Press ▶ and tune the{' '}
          <span className="text-ink">Smooth</span> and <span className="text-ink">Curves</span>{' '}
          sliders
        </li>
      </ol>

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.kind}
            title={p.hint}
            onClick={() => {
              applyCameraPreset(p.kind)
              useEditorStore.getState().select('camera-path')
              useSceneStore.getState().showNotice(`"${p.label}" preset applied — press ▶`)
            }}
            className="rounded-md bg-accent px-2 py-2 text-[12px] font-medium text-white hover:bg-accent/85"
          >
            {p.label}
          </button>
        ))}
      </div>

      <button
        onClick={() => useEditorStore.getState().setTool('pen')}
        className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-md bg-panel-2 px-2 py-2 text-[12px] text-ink hover:bg-panel-3"
      >
        <PenIcon />
        Draw my own path (P)
      </button>
    </div>
  )
}
