import { insertKeyframeAtPlayhead } from '../lib/insertKeyframe'
import {
  focusForObjectChannel,
  hasObjectChannelKeyAtTime,
  objectChannelIsAnimated,
} from '../lib/keyAtPlayhead'
import { OBJECT_CHANNEL_LABELS, type ObjectChannel } from '../lib/keyframes'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'
import { KeyButton } from './primitives'

export function PoseKeyButton({
  objectId,
  channel,
}: {
  objectId: string
  channel: ObjectChannel
}) {
  const t = useRigStore((s) => s.t)
  const object = useSceneStore((s) => s.objects.find((item) => item.id === objectId))
  const keyed = object ? hasObjectChannelKeyAtTime(object.keys, channel, t) : false
  const active = object ? objectChannelIsAnimated(object.keys, channel) : false
  const label = OBJECT_CHANNEL_LABELS[channel]
  const title = keyed
    ? `${label} keyframe at the playhead (I to set, Delete to remove)`
    : `Add a ${label.toLowerCase()} keyframe at the playhead (I)`

  return (
    <KeyButton
      active={active}
      onKey={keyed}
      title={title}
      onClick={() => {
        const editor = useEditorStore.getState()
        if (editor.selection !== `obj:${objectId}`) editor.select(`obj:${objectId}`)
        editor.setKeyableFocus(focusForObjectChannel(channel))
        insertKeyframeAtPlayhead()
      }}
    />
  )
}
