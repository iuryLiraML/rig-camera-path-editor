import type { ValueKey, Vec3Key } from '../lib/keyframes'
import type { ScalarChannel } from '../state/useRigStore'

/**
 * The camera's animatable channels, shared by the timeline tracks and the right
 * panel so both name and format them the same way. Path position lives on the
 * "Camera" track itself; these are the lens and framing channels.
 */
export interface CameraChannel {
  id: ScalarChannel | 'target'
  label: string
  pick: (keys: {
    fovKeys: ValueKey[]
    rollKeys: ValueKey[]
    targetKeys: Vec3Key[]
  }) => { id: string; time: number }[]
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
]

export { deg as formatDegrees }
