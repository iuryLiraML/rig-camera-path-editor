import { detachCinemaToStatic } from './addStaticCamera'
import { KEY_MERGE_EPS } from './keyframes'
import { insertPoseKeyframeAtPlayhead } from './poseKeyframe'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'

/** Start a drone-style take: time advances and fly writes pose keys on the shot fps grid. */
export function startFlyRecord() {
  detachCinemaToStatic({ stayInView: true })
  useRigStore.getState().setLookAtMode('free')
  useRigStore.getState().setPlaying(false)
  insertPoseKeyframeAtPlayhead({ silent: true })
  useEditorStore.getState().setFlyRecording(true)
  useEditorStore.getState().setLookThroughLivePose(true)
  useSceneStore.getState().showNotice('Recording fly — WASD to move, click Stop to finish')
}

export function stopFlyRecord() {
  const editor = useEditorStore.getState()
  if (!editor.flyRecording) return
  insertPoseKeyframeAtPlayhead({ silent: true })
  editor.setFlyRecording(false)
  useRigStore.getState().setPlaying(false)
  useSceneStore.getState().showNotice('Fly take keyed')
}

/** Whether this sample is far enough from the last keyed time to add a new pose. */
export function shouldSampleFlyKey(time: number, lastKeyed: number | null): boolean {
  if (lastKeyed === null) return true
  return Math.abs(time - lastKeyed) >= KEY_MERGE_EPS
}
