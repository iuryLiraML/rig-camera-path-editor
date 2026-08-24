import { writeStaticPose } from '../lib/autoKey'
import { lookPointFromPose, poseFromCamera } from '../lib/staticCamera'
import { useCameraReady } from '../state/cameraPathLink'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { editorCameraRef } from '../viewport/EditorCamera'

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

/**
 * Look through / Match view / Show look-at — lives on the Compose footer
 * so the canvas does not grow a second pill row beside the axis gizmo.
 */
export function LookCluster() {
  const ready = useCameraReady()
  const cameraKind = useRigStore((s) => s.cameraKind)
  const lookAtMode = useRigStore((s) => s.lookAtMode)
  const isStatic = cameraKind === 'static'

  if (!ready) return null

  return (
    <div className="flex rounded-full bg-panel/90 p-0.5 shadow-lg backdrop-blur">
      <Chip
        label="Look through"
        title="See through this camera (Esc to leave)"
        onClick={() => useEditorStore.getState().setCameraView(true)}
      />
      {isStatic && (
        <Chip
          label="Match view"
          title="Snap this camera to the current editor view"
          onClick={() => {
            const cam = editorCameraRef.current
            if (!cam) return
            const pose = poseFromCamera(cam)
            writeStaticPose(pose)
            const rig = useRigStore.getState()
            if (rig.lookAtMode === 'target') rig.setTarget(lookPointFromPose(pose))
          }}
        />
      )}
      {lookAtMode !== 'target' && (
        <Chip
          label="Show look-at"
          title="Add the diamond aim handle in front of the camera"
          onClick={() => {
            const rig = useRigStore.getState()
            rig.setLookAtMode('target')
            if (isStatic) rig.setTarget(lookPointFromPose(rig.staticPose))
          }}
        />
      )}
    </div>
  )
}
