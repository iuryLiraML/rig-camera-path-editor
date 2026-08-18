import { KEY_MERGE_EPS } from './keyframes'

export function hasKeyAtTime(
  keys: { time: number }[],
  t: number,
  eps = KEY_MERGE_EPS,
): boolean {
  return keys.some((key) => Math.abs(key.time - t) < eps)
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
export type KeyableFocus = KeyChannel | 'object'

function isKeyChannel(focus: KeyableFocus | null): focus is KeyChannel {
  return focus !== null && (KEY_CHANNELS as readonly string[]).includes(focus)
}

export function resolveKeyTargets(
  focus: KeyableFocus | null,
  selection: string | null,
  animated: KeyChannel[],
): { channels: KeyChannel[]; object: boolean } {
  if (isKeyChannel(focus)) {
    return { channels: [focus], object: false }
  }
  if (focus === 'object' || selection?.startsWith('obj:')) {
    return { channels: [], object: true }
  }
  if (animated.length === 0) return { channels: ['progress'], object: false }
  return { channels: animated, object: false }
}
