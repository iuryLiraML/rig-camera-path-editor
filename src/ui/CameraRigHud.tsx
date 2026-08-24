import { cinemaAutoKeyArmed } from '../lib/autoKey'
import {
  deletePoseKeyframeAtPlayhead,
  insertPoseKeyframeAtPlayhead,
  poseKeyedAtPlayhead,
} from '../lib/poseKeyframe'
import { useCameraReady } from '../state/cameraPathLink'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { GUTTER, freeAreaRect, useViewportInsets, useWindowSize } from './viewportInsets'

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded bg-panel-3 px-1 py-px font-sans text-[10px] text-ink">
      {children}
    </kbd>
  )
}

function HudButton({
  children,
  title,
  onClick,
  disabled,
}: {
  children: string
  title: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded-full bg-panel/90 px-4 py-1.5 text-[11px] font-medium text-ink shadow-lg backdrop-blur hover:bg-panel-2 disabled:cursor-not-allowed disabled:text-ink-dim disabled:hover:bg-panel/90"
    >
      {children}
    </button>
  )
}

/**
 * Look-through overlay only. Editor-camera chips live on the Compose footer
 * (`LookCluster`) so the axis gizmo is not parked on a second pill row.
 */
export function CameraRigHud() {
  const cameraView = useEditorStore((s) => s.cameraView)
  const playMode = useEditorStore((s) => s.playMode)
  const lookAtMode = useRigStore((s) => s.lookAtMode)
  const armed = useRigStore((s) => cinemaAutoKeyArmed(s))
  const keyed = useRigStore((s) => poseKeyedAtPlayhead(s))
  const ready = useCameraReady()
  const insets = useViewportInsets()
  const win = useWindowSize()
  const aimLocked = lookAtMode === 'target'

  if (playMode || !ready || !cameraView) return null

  const free = freeAreaRect(insets, win.h)

  return (
    <>
      <div
        data-testid="look-through-frame"
        data-recording={armed ? 'true' : 'false'}
        className="pointer-events-none absolute z-10"
        style={{
          left: free.x,
          top: free.y,
          width: free.w,
          height: free.h,
          boxShadow: armed
            ? 'inset 0 0 0 2px rgb(220 38 38 / 0.88)'
            : 'inset 0 0 0 1px rgb(255 255 255 / 0.14)',
        }}
      />
      <div
        data-testid="camera-rig-hud"
        className="pointer-events-auto absolute z-20"
        style={{
          left: insets.left + GUTTER,
          bottom: insets.bottom + GUTTER,
        }}
      >
        <div className="flex items-center gap-x-2 rounded-full bg-panel/90 px-3 py-1.5 text-[11px] text-ink-dim shadow-lg backdrop-blur">
          {armed && <span className="font-medium text-red-400">REC</span>}
          <span className="text-ink">Looking through</span>
          <span className="flex items-center gap-1">
            <Key>WASD</Key>
            <span>/</span>
            <Key>↑↓←→</Key>
            <span>fly</span>
          </span>
          <span>{aimLocked ? 'Aim locked — drag to unlock' : 'Drag to look'}</span>
          <span className="flex items-center gap-1">
            <Key>Wheel</Key>
            <span>speed</span>
          </span>
        </div>
      </div>
      <div
        data-testid="look-through-pose"
        className="pointer-events-auto absolute z-20 flex -translate-x-1/2 items-center gap-2"
        style={{
          left: free.x + free.w / 2,
          bottom: insets.bottom + GUTTER,
        }}
      >
        <HudButton
          title="Set a pose keyframe at the playhead (I)"
          onClick={() => insertPoseKeyframeAtPlayhead()}
        >
          Add pose
        </HudButton>
        <HudButton
          title="Remove the pose keyframe at the playhead"
          disabled={!keyed}
          onClick={() => deletePoseKeyframeAtPlayhead()}
        >
          Remove pose
        </HudButton>
        <HudButton
          title="Back to the editor camera (Esc)"
          onClick={() => useEditorStore.getState().setCameraView(false)}
        >
          Exit camera
        </HudButton>
      </div>
    </>
  )
}
