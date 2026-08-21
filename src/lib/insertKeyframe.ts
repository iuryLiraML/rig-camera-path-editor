import { findKeyAtTime, resolveKeyTargets, type KeyableFocus } from './keyAtPlayhead'
import { insertChannelKeyAt, selectRigKeyAtTime } from './timelineKey'
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
    ] as const
  ).filter((channel): channel is NonNullable<typeof channel> => channel !== null)

  const { channels, object } = resolveKeyTargets(
    editor.keyableFocus,
    editor.selection,
    [...animated],
  )

  if (object) {
    const id = editor.selection?.startsWith('obj:') ? editor.selection.slice(4) : null
    if (!id) {
      useSceneStore.getState().showNotice('Select an object to key')
      return
    }
    useSceneStore.getState().addObjectKey(id, rig.t)
    const next = useSceneStore.getState().objects.find((item) => item.id === id)
    const key = next ? findKeyAtTime(next.keys, rig.t) : undefined
    if (key) {
      editor.selectTimelineKey({ kind: 'object', objectId: id, id: key.id }, `obj:${id}`)
    }
    useSceneStore.getState().showNotice('Pose keyframe set')
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
