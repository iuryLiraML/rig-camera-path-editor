import { hasKeyAtTime } from '../lib/keyAtPlayhead'
import { insertChannelKeyAt, insertVec3GroupAt } from '../lib/timelineKey'
import {
  axisIndexOf,
  VEC3_AXIS_CHANNELS,
  VEC3_AXIS_LABELS,
  VEC3_GROUP_LABELS,
  type Vec3AxisChannel,
  type Vec3GroupId,
} from '../lib/vec3Axes'
import { writeVec3Axis } from '../lib/autoKey'
import { useEditorStore } from '../state/useEditorStore'
import { CHANNEL_FIELD, useRigStore } from '../state/useRigStore'
import type { Vec3 } from '../state/useSceneStore'
import { KeyButton, NumberInput, Row } from './primitives'

const AXIS_LETTER: Record<0 | 1 | 2, 'X' | 'Y' | 'Z'> = { 0: 'X', 1: 'Y', 2: 'Z' }

function AxisRow({
  channel,
  value,
  step,
  onChange,
}: {
  channel: Vec3AxisChannel
  value: number
  step: number
  onChange: (value: number) => void
}) {
  const t = useRigStore((s) => s.t)
  const keys = useRigStore((s) => s[CHANNEL_FIELD[channel]])
  const keyed = hasKeyAtTime(keys, t)
  const letter = AXIS_LETTER[axisIndexOf(channel)]
  const label = VEC3_AXIS_LABELS[channel]
  return (
    <Row label={letter}>
      <NumberInput
        value={value}
        step={step}
        keyed={keyed}
        onFocusChange={(on) => useEditorStore.getState().setKeyableFocus(on ? channel : null)}
        onChange={onChange}
      />
      <KeyButton
        active={keys.length > 0}
        onKey={keyed}
        title={
          keyed
            ? `${label} keyframe at the playhead (I to set, Delete to remove)`
            : `Add a ${label} keyframe at the playhead (I)`
        }
        onClick={() => {
          useEditorStore.getState().setKeyableFocus(channel)
          insertChannelKeyAt(channel, useRigStore.getState().t)
        }}
      />
    </Row>
  )
}

/** Stacked X/Y/Z rows with a group diamond that keys all three at the playhead. */
export function Vec3GroupFields({
  group,
  values,
  step = 0.1,
}: {
  group: Vec3GroupId
  values: Vec3
  step?: number
}) {
  const t = useRigStore((s) => s.t)
  const channels = VEC3_AXIS_CHANNELS[group]
  const xKeys = useRigStore((s) => s[CHANNEL_FIELD[channels[0]]])
  const yKeys = useRigStore((s) => s[CHANNEL_FIELD[channels[1]]])
  const zKeys = useRigStore((s) => s[CHANNEL_FIELD[channels[2]]])
  const bags = [xKeys, yKeys, zKeys]
  const active = bags.some((keys) => keys.length > 0)
  const onKey = bags.every((keys) => hasKeyAtTime(keys, t))
  const name = VEC3_GROUP_LABELS[group]

  return (
    <div className="flex flex-col gap-1.5">
      <Row label={name}>
        <div className="flex flex-1 justify-end">
          <KeyButton
            active={active}
            onKey={onKey}
            title={`Add ${name} X, Y and Z keyframes at the playhead`}
            onClick={() => {
              useEditorStore.getState().setKeyableFocus(channels[0])
              insertVec3GroupAt(group)
            }}
          />
        </div>
      </Row>
      {channels.map((channel, i) => (
        <AxisRow
          key={channel}
          channel={channel}
          value={values[i]}
          step={step}
          onChange={(value) => writeVec3Axis(group, i as 0 | 1 | 2, value)}
        />
      ))}
    </div>
  )
}
