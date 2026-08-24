import { hasKeyAtTime } from '../lib/keyAtPlayhead'
import { insertChannelKeyAt } from '../lib/timelineKey'
import { useEditorStore } from '../state/useEditorStore'
import { useRigStore, type RigChannel } from '../state/useRigStore'
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
  target: 'Look-at',
  lookOffset: 'Look-at offset',
  staticPos: 'Position',
  staticRot: 'Rotation',
}

function keysForChannel(
  channel: RigChannel,
  rig: ReturnType<typeof useRigStore.getState>,
) {
  switch (channel) {
    case 'progress':
      return rig.progressKeys
    case 'fov':
      return rig.fovKeys
    case 'roll':
      return rig.rollKeys
    case 'intensity':
      return rig.intensityKeys
    case 'fadeIn':
      return rig.fadeInKeys
    case 'fadeOut':
      return rig.fadeOutKeys
    case 'ampPos':
      return rig.ampPosKeys
    case 'ampRot':
      return rig.ampRotKeys
    case 'freq':
      return rig.freqKeys
    case 'target':
      return rig.targetKeys
    case 'lookOffset':
      return rig.lookOffsetKeys
    case 'staticPos':
      return rig.staticPosKeys
    case 'staticRot':
      return rig.staticRotKeys
    default: {
      const _never: never = channel
      return _never
    }
  }
}

export function ChannelKeyButton({ channel }: { channel: RigChannel }) {
  const t = useRigStore((s) => s.t)
  const keys = useRigStore((s) => keysForChannel(channel, s))
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
