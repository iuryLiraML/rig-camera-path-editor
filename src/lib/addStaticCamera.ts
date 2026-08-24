import { DEFAULT_STATIC_POSE, useRigStore } from '../state/useRigStore'
import { makeEmptyRigSnapshot, useCameraOptionsStore } from '../state/useCameraOptionsStore'
import { useEditorStore } from '../state/useEditorStore'
import { editorCameraRef } from '../viewport/EditorCamera'
import { cinemaCameraRef } from '../viewport/rig/CinemaCamera'
import { lookPointFromPose, poseFromCamera, posePlacedInView } from './staticCamera'

function poseForNewFreeCamera() {
  const cam = editorCameraRef.current
  return cam ? posePlacedInView(cam) : { ...DEFAULT_STATIC_POSE }
}

function poseFromCinemaOrDefault() {
  const cinema = cinemaCameraRef.current
  if (cinema) return poseFromCamera(cinema)
  return poseForNewFreeCamera()
}

function focusCameraRig() {
  useEditorStore.getState().setCameraView(false)
  useEditorStore.getState().select('cinema-camera')
  useEditorStore.getState().setGizmoMode('translate')
  useEditorStore.getState().setTool('select')
}

/** New pathless camera, placed in front of the editor so the body is visible. */
export function addStaticCamera(): string {
  const pose = poseForNewFreeCamera()
  const snapshot = {
    ...makeEmptyRigSnapshot(),
    cameraKind: 'static' as const,
    staticPose: pose,
    lookAtMode: 'free' as const,
    target: lookPointFromPose(pose),
  }
  const id = useCameraOptionsStore.getState().createOption('Free camera', snapshot)
  useCameraOptionsStore.getState().switchOption(id)
  focusCameraRig()
  return id
}

/**
 * Detach the active camera from its path, keeping the current cinema pose.
 * `stayInView` keeps look-through open so fly / pose keys can continue.
 */
export function detachCinemaToStatic(opts: { stayInView?: boolean } = {}): void {
  const state = useRigStore.getState()
  if (state.cameraKind === 'static') return
  const pose = poseFromCinemaOrDefault()
  state.setStaticPose(pose)
  if (state.lookAtMode === 'path-tangent') {
    state.setLookAtMode('free')
  }
  state.setCameraKind('static')
  if (opts.stayInView) {
    useEditorStore.getState().select('cinema-camera')
    return
  }
  focusCameraRig()
}

/** Detach the active camera from its path, keeping the current cinema pose. */
export function switchActiveCameraToStatic(): void {
  detachCinemaToStatic()
}

export function switchActiveCameraToPath(): void {
  const state = useRigStore.getState()
  if (state.lookAtMode === 'free') state.setLookAtMode('target')
  state.setCameraKind('path')
  useEditorStore.getState().setCameraView(false)
  useEditorStore.getState().select('cinema-camera')
}
