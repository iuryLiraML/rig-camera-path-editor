import type { CameraNoise } from './cameraNoise'
import type { CinemaChannels } from './evaluateCinemaPose'
import type { EaseKind } from './easing'
import type { ModelKey, ProgressKey, ValueKey } from './keyframes'
import type { LookAtMode } from './evaluateCinemaPose'
import type { PathSpace } from './pathSpace'
import type { FollowConfig, Transform, Vec3 } from '../state/useSceneStore'
import type { PathAnchor } from '../state/usePathStore'
import { resolveTrackTarget } from './objectMotion'

export function cinemaChannelsFromRig(
  rig: {
    progressKeys: ProgressKey[]
    fovKeys: ValueKey[]
    rollKeys: ValueKey[]
    intensityKeys?: ValueKey[]
    fadeInKeys?: ValueKey[]
    fadeOutKeys?: ValueKey[]
    ampPosKeys?: ValueKey[]
    ampRotKeys?: ValueKey[]
    freqKeys?: ValueKey[]
    targetXKeys?: ValueKey[]
    targetYKeys?: ValueKey[]
    targetZKeys?: ValueKey[]
    lookOffset?: Vec3
    lookOffsetXKeys?: ValueKey[]
    lookOffsetYKeys?: ValueKey[]
    lookOffsetZKeys?: ValueKey[]
    staticPosXKeys?: ValueKey[]
    staticPosYKeys?: ValueKey[]
    staticPosZKeys?: ValueKey[]
    staticRotXKeys?: ValueKey[]
    staticRotYKeys?: ValueKey[]
    staticRotZKeys?: ValueKey[]
    fov: number
    roll: number
    target: Vec3
    ease: EaseKind
    lookAtMode: LookAtMode
    cameraNoise: CameraNoise
    duration: number
    targetObjectId?: string | null
    pathSpace?: PathSpace
    cameraKind?: 'path' | 'static'
    staticPose?: { position: Vec3; rotation: Vec3 }
  },
  scene?: {
    objects: Array<{
      id: string
      transform: Transform
      keys: ModelKey[]
      follow?: FollowConfig
    }>
    paths: Array<{ id: string; anchors: PathAnchor[]; closed: boolean; rounding: number }>
  },
): CinemaChannels {
  const track = scene ? resolveTrackTarget(rig.targetObjectId, scene.objects, scene.paths) : null
  return {
    progressKeys: rig.progressKeys,
    fovKeys: rig.fovKeys,
    rollKeys: rig.rollKeys,
    intensityKeys: rig.intensityKeys,
    fadeInKeys: rig.fadeInKeys,
    fadeOutKeys: rig.fadeOutKeys,
    ampPosKeys: rig.ampPosKeys,
    ampRotKeys: rig.ampRotKeys,
    freqKeys: rig.freqKeys,
    targetXKeys: rig.targetXKeys ?? [],
    targetYKeys: rig.targetYKeys ?? [],
    targetZKeys: rig.targetZKeys ?? [],
    lookOffset: rig.lookOffset ?? [0, 0, 0],
    lookOffsetXKeys: rig.lookOffsetXKeys ?? [],
    lookOffsetYKeys: rig.lookOffsetYKeys ?? [],
    lookOffsetZKeys: rig.lookOffsetZKeys ?? [],
    staticPosXKeys: rig.staticPosXKeys ?? [],
    staticPosYKeys: rig.staticPosYKeys ?? [],
    staticPosZKeys: rig.staticPosZKeys ?? [],
    staticRotXKeys: rig.staticRotXKeys ?? [],
    staticRotYKeys: rig.staticRotYKeys ?? [],
    staticRotZKeys: rig.staticRotZKeys ?? [],
    fov: rig.fov,
    roll: rig.roll,
    target: rig.target,
    ease: rig.ease,
    lookAtMode: rig.lookAtMode,
    noise: rig.cameraNoise,
    duration: rig.duration,
    track,
    pathParent: rig.pathSpace === 'object' ? track : null,
    cameraKind: rig.cameraKind ?? 'path',
    staticPose: rig.staticPose,
  }
}
