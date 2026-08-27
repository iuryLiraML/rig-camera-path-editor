import {
  findKeyAtTime,
  KEY_CHANNELS,
  objectChannelsForFocus,
  resolveKeyTargets,
  type KeyableFocus,
  type KeyChannel,
} from './keyAtPlayhead'
import {
  groupedTimelineVec3,
  insertChannelKeyAt,
  insertVec3GroupAt,
  selectRigKeyAtTime,
} from './timelineKey'
import { VEC3_AXIS_CHANNELS, VEC3_GROUP_LABELS } from './vec3Axes'
import { requestPersistFlush } from './persistFlush'
import { keysForObjectChannel, OBJECT_CHANNEL_LABELS, type ValueKey } from './keyframes'
import { useEditorStore } from '../state/useEditorStore'
import { CHANNEL_FIELD, useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'

export function insertKeyframeAtPlayhead() {
  const editor = useEditorStore.getState()
  const rig = useRigStore.getState()
  rig.setPlaying(false)

  if (!editor.keyableFocus && !editor.selection?.startsWith('obj:') && rig.cameraKind === 'static') {
    const anyAxis = KEY_CHANNELS.some((channel) => {
      if (channel === 'progress') return rig.progressKeys.length > 0
      return (rig[CHANNEL_FIELD[channel]] as ValueKey[]).length > 0
    })
    if (!anyAxis) {
      insertVec3GroupAt('staticPos')
      selectRigKeyAtTime('staticPosX', rig.t)
      useSceneStore.getState().showNotice('Keyframe set (Position)')
      return
    }
  }

  const grouped = groupedTimelineVec3(editor.keyableFocus)
  if (grouped && !editor.timelineGraph) {
    insertVec3GroupAt(grouped)
    selectRigKeyAtTime(VEC3_AXIS_CHANNELS[grouped][0], rig.t)
    useSceneStore.getState().showNotice(`Keyframe set (${VEC3_GROUP_LABELS[grouped]})`)
    return
  }

  const animated = KEY_CHANNELS.filter((channel): channel is KeyChannel => {
    if (channel === 'progress') return rig.progressKeys.length > 0
    return (rig[CHANNEL_FIELD[channel]] as ValueKey[]).length > 0
  })

  const { channels, object, objectChannels } = resolveKeyTargets(
    editor.keyableFocus,
    editor.selection,
    [...animated],
    'progress',
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
