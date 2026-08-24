import type { EaseKind } from './easing'
import { evalValue, evalVec3, type ValueKey, type Vec3Key } from './keyframes'
import type { Vec3 } from '../state/useSceneStore'

export const VEC3_GROUP_IDS = ['staticPos', 'staticRot', 'lookOffset', 'target'] as const
export type Vec3GroupId = (typeof VEC3_GROUP_IDS)[number]

export const VEC3_AXIS_CHANNELS = {
  staticPos: ['staticPosX', 'staticPosY', 'staticPosZ'],
  staticRot: ['staticRotX', 'staticRotY', 'staticRotZ'],
  lookOffset: ['lookOffsetX', 'lookOffsetY', 'lookOffsetZ'],
  target: ['targetX', 'targetY', 'targetZ'],
} as const satisfies Record<Vec3GroupId, readonly [string, string, string]>

export type Vec3AxisChannel = (typeof VEC3_AXIS_CHANNELS)[Vec3GroupId][number]

export const VEC3_AXIS_CHANNEL_LIST: Vec3AxisChannel[] = VEC3_GROUP_IDS.flatMap(
  (group) => [...VEC3_AXIS_CHANNELS[group]],
)

const AXIS_SET = new Set<string>(VEC3_AXIS_CHANNEL_LIST)

export function isVec3AxisChannel(channel: string): channel is Vec3AxisChannel {
  return AXIS_SET.has(channel)
}

export function isVec3GroupId(channel: string): channel is Vec3GroupId {
  return (VEC3_GROUP_IDS as readonly string[]).includes(channel)
}

export function vec3GroupOf(channel: Vec3AxisChannel): Vec3GroupId {
  switch (channel) {
    case 'staticPosX':
    case 'staticPosY':
    case 'staticPosZ':
      return 'staticPos'
    case 'staticRotX':
    case 'staticRotY':
    case 'staticRotZ':
      return 'staticRot'
    case 'lookOffsetX':
    case 'lookOffsetY':
    case 'lookOffsetZ':
      return 'lookOffset'
    case 'targetX':
    case 'targetY':
    case 'targetZ':
      return 'target'
    default: {
      const _never: never = channel
      return _never
    }
  }
}

export function axisIndexOf(channel: Vec3AxisChannel): 0 | 1 | 2 {
  switch (channel) {
    case 'staticPosX':
    case 'staticRotX':
    case 'lookOffsetX':
    case 'targetX':
      return 0
    case 'staticPosY':
    case 'staticRotY':
    case 'lookOffsetY':
    case 'targetY':
      return 1
    case 'staticPosZ':
    case 'staticRotZ':
    case 'lookOffsetZ':
    case 'targetZ':
      return 2
    default: {
      const _never: never = channel
      return _never
    }
  }
}

export const VEC3_AXIS_LABELS: Record<Vec3AxisChannel, string> = {
  staticPosX: 'Position X',
  staticPosY: 'Position Y',
  staticPosZ: 'Position Z',
  staticRotX: 'Rotation X',
  staticRotY: 'Rotation Y',
  staticRotZ: 'Rotation Z',
  lookOffsetX: 'Offset X',
  lookOffsetY: 'Offset Y',
  lookOffsetZ: 'Offset Z',
  targetX: 'Look-At X',
  targetY: 'Look-At Y',
  targetZ: 'Look-At Z',
}

export const VEC3_GROUP_LABELS: Record<Vec3GroupId, string> = {
  staticPos: 'Position',
  staticRot: 'Rotation',
  lookOffset: 'Offset',
  target: 'Look-At',
}

export function axisChannelField(channel: Vec3AxisChannel): `${Vec3AxisChannel}Keys` {
  return `${channel}Keys`
}

/** Split a coupled vec3 track into three independent scalar tracks. */
export function explodeVec3Keys(keys: Vec3Key[]): [ValueKey[], ValueKey[], ValueKey[]] {
  const x: ValueKey[] = []
  const y: ValueKey[] = []
  const z: ValueKey[] = []
  for (const key of keys) {
    const shared = {
      time: key.time,
      ease: key.ease,
      easeBezier: key.easeBezier,
      easeIn: key.easeIn,
      easeOut: key.easeOut,
    }
    x.push({ ...shared, id: `${key.id}-x`, value: key.value[0] })
    y.push({ ...shared, id: `${key.id}-y`, value: key.value[1] })
    z.push({ ...shared, id: `${key.id}-z`, value: key.value[2] })
  }
  return [x, y, z]
}

export function evalSeparatedVec3(
  t: number,
  xKeys: ValueKey[],
  yKeys: ValueKey[],
  zKeys: ValueKey[],
  fallback: Vec3,
  defaultEase: EaseKind,
): Vec3 {
  return [
    evalValue(t, xKeys, fallback[0], defaultEase),
    evalValue(t, yKeys, fallback[1], defaultEase),
    evalValue(t, zKeys, fallback[2], defaultEase),
  ]
}

/**
 * Prefer independent axis tracks. Empty scalars fall back to a legacy coupled
 * vec3 list so older snapshots and eval tests keep working.
 */
export function evalCinemaVec3(
  t: number,
  axes: { x?: ValueKey[]; y?: ValueKey[]; z?: ValueKey[] } | undefined,
  legacy: Vec3Key[] | undefined,
  fallback: Vec3,
  defaultEase: EaseKind,
): Vec3 {
  const x = axes?.x ?? []
  const y = axes?.y ?? []
  const z = axes?.z ?? []
  if (x.length > 0 || y.length > 0 || z.length > 0) {
    return evalSeparatedVec3(t, x, y, z, fallback, defaultEase)
  }
  return evalVec3(t, legacy ?? [], fallback, defaultEase)
}

/** Sample all axes at every unique key time so older builds can still read a dump. */
export function composeVec3Keys(
  xKeys: ValueKey[],
  yKeys: ValueKey[],
  zKeys: ValueKey[],
  fallback: Vec3,
  defaultEase: EaseKind,
  idPrefix: string,
): Vec3Key[] {
  const times = new Set<number>()
  for (const key of xKeys) times.add(key.time)
  for (const key of yKeys) times.add(key.time)
  for (const key of zKeys) times.add(key.time)
  return [...times]
    .sort((a, b) => a - b)
    .map((time) => ({
      id: `${idPrefix}-${Math.round(time * 1e4)}`,
      time,
      value: evalSeparatedVec3(time, xKeys, yKeys, zKeys, fallback, defaultEase),
    }))
}

export function readValueKeys(value: unknown): ValueKey[] {
  return Array.isArray(value) ? (value as ValueKey[]) : []
}

export function readVec3Keys(value: unknown): Vec3Key[] {
  return Array.isArray(value) ? (value as Vec3Key[]) : []
}

export function emptyVec3AxisKeyState(): Record<`${Vec3AxisChannel}Keys`, ValueKey[]> {
  return {
    staticPosXKeys: [],
    staticPosYKeys: [],
    staticPosZKeys: [],
    staticRotXKeys: [],
    staticRotYKeys: [],
    staticRotZKeys: [],
    lookOffsetXKeys: [],
    lookOffsetYKeys: [],
    lookOffsetZKeys: [],
    targetXKeys: [],
    targetYKeys: [],
    targetZKeys: [],
  }
}

export function hydrateVec3Group(
  data: Record<string, unknown>,
  group: Vec3GroupId,
): { x: ValueKey[]; y: ValueKey[]; z: ValueKey[] } {
  const [cx, cy, cz] = VEC3_AXIS_CHANNELS[group]
  const x = readValueKeys(data[`${cx}Keys`])
  const y = readValueKeys(data[`${cy}Keys`])
  const z = readValueKeys(data[`${cz}Keys`])
  if (x.length > 0 || y.length > 0 || z.length > 0) return { x, y, z }
  const exploded = explodeVec3Keys(readVec3Keys(data[`${group}Keys`]))
  return { x: exploded[0], y: exploded[1], z: exploded[2] }
}
