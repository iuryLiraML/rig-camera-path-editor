import { hasKeyAtTime } from '../lib/keyAtPlayhead'
import { insertChannelKeyAt } from '../lib/timelineKey'
import { VEC3_AXIS_LABELS } from '../lib/vec3Axes'
import { useEditorStore } from '../state/useEditorStore'
import { CHANNEL_FIELD, useRigStore, type RigChannel } from '../state/useRigStore'
import { KeyButton } from './primitives'

const CHANNEL_LABEL: Record<RigChannel, string> = {
  progress: 'On path',
  fov: 'FOV',
  roll: 'Roll',
  intensity: 'FX amount',
  fadeIn: 'Fade in',
  fadeOut: 'Fade out',
  ampPos: 'FX Pos',
  ampRot: 'FX Rot',
  freq: 'FX Freq',
  ...VEC3_AXIS_LABELS,
}

export function ChannelKeyButton({ channel }: { channel: RigChannel }) {
  const t = useRigStore((s) => s.t)
  const keys = useRigStore((s) => s[CHANNEL_FIELD[channel]])
  const keyed = hasKeyAtTime(keys, t)
  const active = keys.length > 0
  const label = CHANNEL_LABEL[channel]
  const title = keyed
    ? `${label} keyframe at the playhead (I to set, Delete to remove)`
    : `Add a ${label} keyframe at the playhead (I)`

  return (
    <KeyButton
      active={active}
      onKey={keyed}
      title={title}
      onClick={() => {
        const editor = useEditorStore.getState()
        if (editor.selection !== 'cinema-camera') editor.select('cinema-camera')
        editor.setKeyableFocus(channel)
        insertChannelKeyAt(channel, useRigStore.getState().t)
      }}
    />
  )
}
