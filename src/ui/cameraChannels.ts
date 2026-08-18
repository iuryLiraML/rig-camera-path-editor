import type { ValueKey, Vec3Key } from '../lib/keyframes'
import type { ScalarChannel } from '../state/useRigStore'

/**
 * The camera's animatable channels, shared by the timeline tracks and the right
 * panel so both name and format them the same way. Path position lives on the
 * "Camera" track itself; these are the lens and framing channels.
 * FX amount has its own clip track, not this list.
 */
export interface CameraChannel {
  id: 'fov' | 'roll' | 'target' | 'lookOffset'
  label: string
  pick: (keys: {
    fovKeys: ValueKey[]
    rollKeys: ValueKey[]
    targetKeys: Vec3Key[]
    lookOffsetKeys: Vec3Key[]
  }) => { id: string; time: number; easeIn?: number; easeOut?: number }[]
  describe: (key: { id: string }) => string
}

const deg = (v: number) => `${Math.round(v)}°`

export const CAMERA_CHANNELS: CameraChannel[] = [
  {
    id: 'fov',
    label: 'FOV',
    pick: (k) => k.fovKeys,
    describe: () => '',
  },
  {
    id: 'roll',
    label: 'Roll',
    pick: (k) => k.rollKeys,
    describe: () => '',
  },
  {
    id: 'target',
    label: 'Look-At',
    pick: (k) => k.targetKeys,
    describe: () => '',
  },
  {
    id: 'lookOffset',
    label: 'Look-At offset',
    pick: (k) => k.lookOffsetKeys,
    describe: () => '',
  },
]

export { deg as formatDegrees }

export type FxParamChannel = {
  id: Exclude<ScalarChannel, 'fov' | 'roll' | 'intensity'>
  label: string
}

/** FX params that get their own timeline track after the first ◆ (Amount stays on FX). */
export const FX_PARAM_CHANNELS: FxParamChannel[] = [
  { id: 'fadeIn', label: 'Fade in' },
  { id: 'fadeOut', label: 'Fade out' },
  { id: 'ampPos', label: 'FX Pos' },
  { id: 'ampRot', label: 'FX Rot' },
  { id: 'freq', label: 'FX Freq' },
]
