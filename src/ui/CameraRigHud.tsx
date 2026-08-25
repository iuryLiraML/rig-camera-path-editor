import type { ReactNode } from 'react'
import {
  COMPOSITION_GUIDE_IDS,
  type CompositionGuideId,
} from '../lib/compositionGuides'
import { startFlyRecord, stopFlyRecord } from '../lib/flyRecord'
import {
  deletePoseKeyframeAtPlayhead,
  insertPoseKeyframeAtPlayhead,
  poseKeyedAtPlayhead,
} from '../lib/poseKeyframe'
import { useCameraReady } from '../state/cameraPathLink'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { exportDimensions } from '../lib/recorder'
import { CompositionOverlay } from './CompositionOverlay'
import { LookThroughRollWheel } from './LookThroughRollWheel'
import { CameraIcon } from './icons'
import { GUTTER, freeAreaRect, useViewportInsets, useWindowSize } from './viewportInsets'

const GUIDE_LABEL: Record<CompositionGuideId, string> = {
  thirds: 'Thirds',
  golden: 'Golden',
  spiral: 'Spiral',
  safe: 'Safe',
}

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
  danger,
  active,
}: {
  children: ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:text-ink-dim ${
        danger
          ? 'bg-red-600/90 text-white hover:bg-red-500'
          : active
            ? 'bg-panel-3 text-ink'
            : 'text-ink hover:bg-panel-2 disabled:hover:bg-transparent'
      }`}
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
  const flyRecording = useEditorStore((s) => s.flyRecording)
  const cameraPanel = useEditorStore((s) => s.cameraPanel)
  const guides = useEditorStore((s) => s.compositionGuides)
  const exportAspect = useEditorStore((s) => s.exportAspect)
  const exportRes = useEditorStore((s) => s.exportRes)
  const customSize = useEditorStore((s) => s.customSize)
  const keyed = useRigStore((s) => poseKeyedAtPlayhead(s))
  const ready = useCameraReady()
  const insets = useViewportInsets()
  const win = useWindowSize()
  const aimLocked = lookAtMode === 'target'

  if (playMode || !ready || !cameraView) return null

  const free = freeAreaRect(insets, win.h)
  const recording = flyRecording
  const [tw, th] = exportDimensions(exportAspect, exportRes, customSize)
  const filmAspect = tw / Math.max(1, th)

  return (
    <>
      <div
        data-testid="look-through-frame"
        data-recording={recording ? 'true' : 'false'}
        className="pointer-events-none absolute z-10 overflow-hidden"
        style={{
          left: free.x,
          top: free.y,
          width: free.w,
          height: free.h,
          boxShadow: recording
            ? 'inset 0 0 0 2px rgb(220 38 38 / 0.88)'
            : 'inset 0 0 0 1px rgb(255 255 255 / 0.14)',
        }}
      >
        <CompositionOverlay
          width={free.w}
          height={free.h}
          aspect={filmAspect}
          guides={guides}
        />
      </div>
      <div
        data-testid="composition-guide-bar"
        className="pointer-events-auto absolute z-20 flex -translate-x-1/2 items-center gap-1 rounded-full bg-panel/90 px-1.5 py-1 shadow-lg backdrop-blur"
        style={{
          left: free.x + free.w / 2,
          top: free.y + GUTTER,
        }}
      >
        {COMPOSITION_GUIDE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            title={`${guides[id] ? 'Hide' : 'Show'} ${GUIDE_LABEL[id].toLowerCase()} guide`}
            aria-pressed={guides[id]}
            onClick={() => useEditorStore.getState().toggleCompositionGuide(id)}
            className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
              guides[id] ? 'bg-panel-3 text-ink' : 'text-ink-dim hover:text-ink'
            }`}
          >
            {GUIDE_LABEL[id]}
          </button>
        ))}
      </div>
      <div
        data-testid="look-through-roll-dock"
        className="pointer-events-auto absolute z-20"
        style={{
          left: free.x + free.w - GUTTER,
          top: free.y + free.h / 2,
          transform: 'translate(-100%, -50%)',
        }}
      >
        <LookThroughRollWheel />
      </div>
      <div
        data-testid="camera-rig-hud"
        className="pointer-events-none absolute z-20 flex items-center justify-between gap-3"
        style={{
          left: insets.left + GUTTER,
          width: Math.max(0, free.w - GUTTER * 2),
          bottom: insets.bottom + GUTTER,
        }}
      >
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-full bg-panel/90 px-2 py-1 shadow-lg backdrop-blur">
          {recording && <span className="shrink-0 px-1.5 text-[11px] font-medium text-red-400">REC</span>}
          <button
            type="button"
            title="Leave look-through (Esc)"
            onClick={() => {
              stopFlyRecord()
              useEditorStore.getState().setCameraView(false)
            }}
            className="rounded-full px-2.5 py-1 text-[11px] font-medium text-ink hover:bg-panel-2"
          >
            Looking through · Esc
          </button>
          <span className="flex shrink-0 items-center gap-1 pr-1.5 text-[11px] text-ink-dim">
            <Key>{aimLocked ? 'Scroll' : 'WASD'}</Key>
            <span>{aimLocked ? 'FOV' : 'fly'}</span>
          </span>
        </div>
        <div
          data-testid="look-through-pose"
          className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-full bg-panel/90 p-1 shadow-lg backdrop-blur"
        >
          {recording ? (
            <HudButton title="Stop recording this fly take" danger onClick={() => stopFlyRecord()}>
              Stop record
            </HudButton>
          ) : (
            <HudButton
              title="Fly the camera like a drone and key the take as time plays"
              onClick={() => startFlyRecord()}
            >
              Record fly
            </HudButton>
          )}
          <HudButton
            title="Set a pose keyframe at the playhead (I)"
            disabled={recording}
            onClick={() => insertPoseKeyframeAtPlayhead()}
          >
            Add pose
          </HudButton>
          <HudButton
            title="Remove the pose keyframe at the playhead"
            disabled={!keyed || recording}
            onClick={() => deletePoseKeyframeAtPlayhead()}
          >
            Remove pose
          </HudButton>
          <HudButton
            title="Camera settings"
            active={cameraPanel !== 'closed'}
            onClick={() => {
              const editor = useEditorStore.getState()
              editor.setCameraPanel(editor.cameraPanel === 'closed' ? 'adjust' : 'closed')
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <CameraIcon size={13} />
              Camera settings
            </span>
          </HudButton>
          <HudButton
            title="Back to the editor camera (Esc)"
            onClick={() => {
              stopFlyRecord()
              useEditorStore.getState().setCameraView(false)
            }}
          >
            Exit camera
          </HudButton>
        </div>
      </div>
    </>
  )
}
