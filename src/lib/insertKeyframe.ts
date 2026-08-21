import {
  findKeyAtTime,
  objectChannelsForFocus,
  resolveKeyTargets,
  type KeyableFocus,
} from './keyAtPlayhead'
import { insertChannelKeyAt, selectRigKeyAtTime } from './timelineKey'
import { requestPersistFlush } from './persistFlush'
import { keysForObjectChannel, OBJECT_CHANNEL_LABELS } from './keyframes'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'

export function insertKeyframeAtPlayhead() {
  const editor = useEditorStore.getState()
  const rig = useRigStore.getState()
  rig.setPlaying(false)
  const animated = (
    [
      rig.progressKeys.length > 0 ? 'progress' : null,
      rig.fovKeys.length > 0 ? 'fov' : null,
      rig.rollKeys.length > 0 ? 'roll' : null,
      rig.intensityKeys.length > 0 ? 'intensity' : null,
      rig.fadeInKeys.length > 0 ? 'fadeIn' : null,
      rig.fadeOutKeys.length > 0 ? 'fadeOut' : null,
      rig.ampPosKeys.length > 0 ? 'ampPos' : null,
      rig.ampRotKeys.length > 0 ? 'ampRot' : null,
      rig.freqKeys.length > 0 ? 'freq' : null,
      rig.targetKeys.length > 0 ? 'target' : null,
      rig.lookOffsetKeys.length > 0 ? 'lookOffset' : null,
      rig.staticPosKeys.length > 0 ? 'staticPos' : null,
      rig.staticRotKeys.length > 0 ? 'staticRot' : null,
    ] as const
  ).filter((channel): channel is NonNullable<typeof channel> => channel !== null)

  const { channels, object, objectChannels } = resolveKeyTargets(
    editor.keyableFocus,
    editor.selection,
    [...animated],
    rig.cameraKind === 'static' ? 'staticPos' : 'progress',
  )

  if (object) {
    const id = editor.selection?.startsWith('obj:') ? editor.selection.slice(4) : null
    if (!id) {
      useSceneStore.getState().showNotice('Select an object to key')
      return
    }
    const targets = objectChannels.length > 0 ? objectChannels : objectChannelsForFocus(editor.keyableFocus)
    const scene = useSceneStore.getState()
    for (const channel of targets) scene.addObjectKey(id, rig.t, channel)
    const next = useSceneStore.getState().objects.find((item) => item.id === id)
    const selectChannel = targets.length === 1 ? targets[0] : undefined
    const key =
      next && selectChannel
        ? findKeyAtTime(keysForObjectChannel(next.keys, selectChannel), rig.t)
        : undefined
    if (key) {
      editor.selectTimelineKey({ kind: 'object', objectId: id, id: key.id }, `obj:${id}`)
    }
    const label =
      targets.length === 1 ? OBJECT_CHANNEL_LABELS[targets[0]] : 'Pose'
    useSceneStore.getState().showNotice(`${label} keyframe set`)
    requestPersistFlush()
    return
  }

  for (const channel of channels) insertChannelKeyAt(channel, rig.t)
  const last = channels[channels.length - 1]
  if (last) selectRigKeyAtTime(last, rig.t)

  const label = channels.length === 1 ? channels[0] : `${channels.length} channels`
  useSceneStore.getState().showNotice(`Keyframe set (${label})`)
}

export function setKeyableFocus(focus: KeyableFocus | null) {
  useEditorStore.getState().setKeyableFocus(focus)
}
