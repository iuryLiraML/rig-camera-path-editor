import type { ValueKey } from '../lib/keyframes'
import type { Vec3AxisChannel } from '../lib/vec3Axes'
import { VEC3_AXIS_LABELS } from '../lib/vec3Axes'

/**
 * Lens channels for the graph editor (and leftover timeline rows once keyed).
 * Path position lives on the Position track; pose / look-at axes are listed in
 * CAMERA_AXIS_TRACKS so each dimension can be keyed on its own.
 */
export interface CameraChannel {
  id: 'fov' | 'roll'
  label: string
  pick: (keys: { fovKeys: ValueKey[]; rollKeys: ValueKey[] }) => ValueKey[]
}

export const CAMERA_CHANNELS: CameraChannel[] = [
  {
    id: 'fov',
    label: 'FOV',
    pick: (k) => k.fovKeys,
  },
  {
    id: 'roll',
    label: 'Roll',
    pick: (k) => k.rollKeys,
  },
]

export type CameraAxisWhen = 'static' | 'target' | 'offset'

export type CameraAxisTrack = {
  id: Vec3AxisChannel
  label: string
  format: 'look' | 'degrees'
  when: CameraAxisWhen
}

export const CAMERA_AXIS_TRACKS: CameraAxisTrack[] = [
  { id: 'staticPosX', label: `Camera · ${VEC3_AXIS_LABELS.staticPosX}`, format: 'look', when: 'static' },
  { id: 'staticPosY', label: `Camera · ${VEC3_AXIS_LABELS.staticPosY}`, format: 'look', when: 'static' },
  { id: 'staticPosZ', label: `Camera · ${VEC3_AXIS_LABELS.staticPosZ}`, format: 'look', when: 'static' },
  { id: 'staticRotX', label: `Camera · ${VEC3_AXIS_LABELS.staticRotX}`, format: 'degrees', when: 'static' },
  { id: 'staticRotY', label: `Camera · ${VEC3_AXIS_LABELS.staticRotY}`, format: 'degrees', when: 'static' },
  { id: 'staticRotZ', label: `Camera · ${VEC3_AXIS_LABELS.staticRotZ}`, format: 'degrees', when: 'static' },
  { id: 'targetX', label: VEC3_AXIS_LABELS.targetX, format: 'look', when: 'target' },
  { id: 'targetY', label: VEC3_AXIS_LABELS.targetY, format: 'look', when: 'target' },
  { id: 'targetZ', label: VEC3_AXIS_LABELS.targetZ, format: 'look', when: 'target' },
  { id: 'lookOffsetX', label: VEC3_AXIS_LABELS.lookOffsetX, format: 'look', when: 'offset' },
  { id: 'lookOffsetY', label: VEC3_AXIS_LABELS.lookOffsetY, format: 'look', when: 'offset' },
  { id: 'lookOffsetZ', label: VEC3_AXIS_LABELS.lookOffsetZ, format: 'look', when: 'offset' },
]

const deg = (v: number) => `${Math.round(v)}°`

export { deg as formatDegrees }

export type FxParamChannel = {
  id: 'fadeIn' | 'fadeOut' | 'ampPos' | 'ampRot' | 'freq'
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
