import {
  KEY_MERGE_EPS,
  OBJECT_CHANNELS,
  keysForObjectChannel,
  type ModelKey,
  type ObjectChannel,
} from './keyframes'

export function findKeyAtTime<T extends { time: number }>(
  keys: T[],
  t: number,
  eps = KEY_MERGE_EPS,
): T | undefined {
  return keys.find((key) => Math.abs(key.time - t) < eps)
}

export function hasKeyAtTime(
  keys: { time: number }[],
  t: number,
  eps = KEY_MERGE_EPS,
): boolean {
  return findKeyAtTime(keys, t, eps) !== undefined
}

export const KEY_CHANNELS = [
  'progress',
  'fov',
  'roll',
  'intensity',
  'fadeIn',
  'fadeOut',
  'ampPos',
  'ampRot',
  'freq',
  'target',
  'lookOffset',
] as const

export type KeyChannel = (typeof KEY_CHANNELS)[number]
export type ObjectKeyFocus = 'object' | 'objectPosition' | 'objectRotation' | 'objectScale'
export type KeyableFocus = KeyChannel | ObjectKeyFocus

export function isKeyChannel(focus: KeyableFocus | null): focus is KeyChannel {
  return focus !== null && (KEY_CHANNELS as readonly string[]).includes(focus)
}

export function isObjectKeyFocus(focus: KeyableFocus | null): focus is ObjectKeyFocus {
  return (
    focus === 'object' ||
    focus === 'objectPosition' ||
    focus === 'objectRotation' ||
    focus === 'objectScale'
  )
}

export function focusForObjectChannel(channel: ObjectChannel): ObjectKeyFocus {
  switch (channel) {
    case 'position':
      return 'objectPosition'
    case 'rotation':
      return 'objectRotation'
    case 'scale':
      return 'objectScale'
    default: {
      const _never: never = channel
      return _never
    }
  }
}

export function objectChannelsForFocus(focus: KeyableFocus | null): ObjectChannel[] {
  switch (focus) {
    case 'objectPosition':
      return ['position']
    case 'objectRotation':
      return ['rotation']
    case 'objectScale':
      return ['scale']
    default:
      return [...OBJECT_CHANNELS]
  }
}

/** True when this channel has a driving key at the playhead (channel or legacy pose). */
export function hasObjectChannelKeyAtTime(
  keys: ModelKey[],
  channel: ObjectChannel,
  t: number,
): boolean {
  return hasKeyAtTime(keysForObjectChannel(keys, channel), t)
}

export function objectChannelIsAnimated(keys: ModelKey[], channel: ObjectChannel): boolean {
  return keysForObjectChannel(keys, channel).length > 0
}

/**
 * I / diamond targeting.
 *
 * Camera: focused channel only.
 * Object: focused Transform row (Position / Rotation / Scale) only.
 * Object selected with no row focused (`'object'` or Transform open): all three
 * transform channels, matching After Effects (layer selected, no property).
 */
export function resolveKeyTargets(
  focus: KeyableFocus | null,
  selection: string | null,
  animated: KeyChannel[],
): { channels: KeyChannel[]; object: boolean; objectChannels: ObjectChannel[] } {
  if (isKeyChannel(focus)) {
    return { channels: [focus], object: false, objectChannels: [] }
  }
  switch (focus) {
    case 'objectPosition':
      return { channels: [], object: true, objectChannels: ['position'] }
    case 'objectRotation':
      return { channels: [], object: true, objectChannels: ['rotation'] }
    case 'objectScale':
      return { channels: [], object: true, objectChannels: ['scale'] }
    case 'object':
      return { channels: [], object: true, objectChannels: [...OBJECT_CHANNELS] }
    case null:
      break
    default: {
      const _never: never = focus
      return _never
    }
  }
  if (selection?.startsWith('obj:')) {
    return { channels: [], object: true, objectChannels: [...OBJECT_CHANNELS] }
  }
  if (animated.length === 0) return { channels: ['progress'], object: false, objectChannels: [] }
  return { channels: animated, object: false, objectChannels: [] }
}
