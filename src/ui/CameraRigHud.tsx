import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { editorCameraRef } from '../viewport/EditorCamera'
import { lookPointFromPose, poseFromCamera } from '../lib/staticCamera'
import { GUTTER, useViewportInsets } from './viewportInsets'

function Chip({
  label,
  title,
  onClick,
}: {
  label: string
  title: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-full px-2.5 py-1 text-[11px] text-ink-dim transition-colors hover:text-ink"
    >
      {label}
    </button>
  )
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded bg-panel-3 px-1 py-px font-sans text-[10px] text-ink">
      {children}
    </kbd>
  )
}

/**
 * On-viewport chrome for a pathless camera. Posing happens in the 3D view
 * (select the camera for the gizmo, orange handles truck/aim); this HUD is
 * look-through, match-view, and fly keys.
 */
export function CameraRigHud() {
  const cameraView = useEditorStore((s) => s.cameraView)
  const playMode = useEditorStore((s) => s.playMode)
  const cameraKind = useRigStore((s) => s.cameraKind)
  const lookAtMode = useRigStore((s) => s.lookAtMode)
  const insets = useViewportInsets()
  const aimLocked = lookAtMode === 'target'

  if (playMode || cameraKind !== 'static') return null

  return (
    <div
      className="pointer-events-auto absolute z-20 flex flex-col items-start gap-1.5"
      style={{
        left: insets.left + GUTTER,
        bottom: cameraView ? insets.bottom + GUTTER : insets.contentBottom,
      }}
    >
      {cameraView ? (
        <div className="flex max-w-sm flex-wrap items-center gap-x-2 gap-y-1 rounded-full bg-panel/90 px-3 py-1.5 text-[11px] text-ink-dim shadow-lg backdrop-blur">
          <span className="flex items-center gap-1">
            <Key>W</Key>
            <Key>A</Key>
            <Key>S</Key>
            <Key>D</Key>
            <span>move</span>
          </span>
          <span className="flex items-center gap-1">
            <Key>Q</Key>
            <Key>E</Key>
            <span>up/down</span>
          </span>
          <span className="flex items-center gap-1">
            <Key>Shift</Key>
            <span>fast</span>
          </span>
          <span>
            {aimLocked ? 'Aim locked to look-at · Esc exits' : 'Right-drag to look · Esc exits'}
          </span>
        </div>
      ) : (
        <div className="flex rounded-full bg-panel/90 p-0.5 shadow-lg backdrop-blur">
          <Chip
            label="Look through"
            title="See through this camera, then fly with WASD"
            onClick={() => useEditorStore.getState().setCameraView(true)}
          />
          <Chip
            label="Match view"
            title="Snap this camera to the current editor view"
            onClick={() => {
              const cam = editorCameraRef.current
              if (!cam) return
              const pose = poseFromCamera(cam)
              const rig = useRigStore.getState()
              rig.setStaticPose(pose)
              if (rig.lookAtMode === 'target') rig.setTarget(lookPointFromPose(pose))
            }}
          />
          {lookAtMode !== 'target' && (
            <Chip
              label="Show look-at"
              title="Add the diamond aim handle in front of the camera"
              onClick={() => {
                const rig = useRigStore.getState()
                rig.setLookAtMode('target')
                rig.setTarget(lookPointFromPose(rig.staticPose))
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
