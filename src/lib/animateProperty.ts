import { focusForObjectChannel } from './keyAtPlayhead'
import { OBJECT_CHANNEL_LABELS, type ObjectChannel } from './keyframes'
import { requestPersistFlush } from './persistFlush'
import { insertChannelKeyAt } from './timelineKey'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore, type CameraKind } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'

export type AnimateMenuItem =
  | { kind: 'object'; channel: ObjectChannel; label: string }
  | { kind: 'rig'; channel: 'staticPos' | 'staticRot' | 'fov' | 'roll'; label: string }

const OBJECT_ITEMS: AnimateMenuItem[] = [
  { kind: 'object', channel: 'position', label: OBJECT_CHANNEL_LABELS.position },
  { kind: 'object', channel: 'rotation', label: OBJECT_CHANNEL_LABELS.rotation },
  { kind: 'object', channel: 'scale', label: OBJECT_CHANNEL_LABELS.scale },
]

const FREE_CAMERA_ITEMS: AnimateMenuItem[] = [
  { kind: 'rig', channel: 'staticPos', label: 'Position' },
  { kind: 'rig', channel: 'staticRot', label: 'Rotation' },
  { kind: 'rig', channel: 'fov', label: 'FOV' },
  { kind: 'rig', channel: 'roll', label: 'Roll' },
]

/** Properties the + Animate menu offers for the current selection. */
export function animateMenuItems(
  selection: string | null,
  cameraKind: CameraKind,
): AnimateMenuItem[] {
  if (selection?.startsWith('obj:')) return OBJECT_ITEMS
  if (cameraKind === 'static' && (selection === 'cinema-camera' || selection === null)) {
    return FREE_CAMERA_ITEMS
  }
  return []
}

/** Add the track and a key at the playhead (Spline's first + Animate click). */
export function animateProperty(item: AnimateMenuItem) {
  const editor = useEditorStore.getState()
  const rig = useRigStore.getState()
  rig.setPlaying(false)
  if (item.kind === 'object') {
    const id = editor.selection?.startsWith('obj:') ? editor.selection.slice(4) : null
    if (!id) {
      useSceneStore.getState().showNotice('Select an object, then + Animate')
      return
    }
    editor.setKeyableFocus(focusForObjectChannel(item.channel))
    useSceneStore.getState().addObjectKey(id, rig.t, item.channel)
    requestPersistFlush()
    useSceneStore.getState().showNotice(`${item.label} keyframe set`)
    return
  }
  editor.select('cinema-camera')
  editor.setKeyableFocus(item.channel)
  insertChannelKeyAt(item.channel, rig.t)
  useSceneStore.getState().showNotice(`${item.label} keyframe set`)
}
