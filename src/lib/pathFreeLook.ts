import * as THREE from 'three'
import { writeStaticPose } from './autoKey'
import { cinemaChannelsFromRig } from './cinemaChannels'
import { evaluateCinemaPose, type LookAtMode } from './evaluateCinemaPose'
import { eulerDegFromQuaternion } from './staticCamera'
import { cameraPath } from '../state/cameraPathLink'
import { usePathStore } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'

const _q = new THREE.Quaternion()

/** Copy the current cinema view into authored YXZ rotation (roll stays on Roll). */
export function seedFreeLookFromCinema() {
  const rig = useRigStore.getState()
  const path = cameraPath()
  const channels = cinemaChannelsFromRig(rig, {
    objects: useSceneStore.getState().objects,
    paths: usePathStore.getState().paths,
  })
  const pose = evaluateCinemaPose(
    rig.t,
    path
      ? { anchors: path.anchors, closed: path.closed, rounding: path.rounding }
      : { anchors: [] },
    { ...channels, roll: 0, rollKeys: [] },
  )
  if (!pose) return
  _q.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3])
  writeStaticPose({ rotation: eulerDegFromQuaternion(_q) }, { key: false })
}

/** Switch look mode. Entering Free seeds rotation so the view does not jump. */
export function applyLookAtMode(mode: LookAtMode) {
  const rig = useRigStore.getState()
  if (mode === 'free' && rig.lookAtMode !== 'free') seedFreeLookFromCinema()
  useRigStore.getState().setLookAtMode(mode)
}
