import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyLookAtMode } from './pathFreeLook'
import { cinemaChannelsFromRig } from './cinemaChannels'
import { evaluateCinemaPose } from './evaluateCinemaPose'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'

function lineAnchors() {
  return [
    {
      id: 'a',
      position: [0, 1, 5] as [number, number, number],
      handleIn: [0, 0, 0] as [number, number, number],
      handleOut: [0, 0, 0] as [number, number, number],
      mirrored: true,
      manual: false,
    },
    {
      id: 'b',
      position: [0, 1, 1] as [number, number, number],
      handleIn: [0, 0, 0] as [number, number, number],
      handleOut: [0, 0, 0] as [number, number, number],
      mirrored: true,
      manual: false,
    },
  ]
}

describe('applyLookAtMode', () => {
  it('seeds Free from the current cinema view so the shot does not jump', () => {
    usePathStore.getState().setPathData(CAMERA_PATH_ID, {
      anchors: lineAnchors(),
      rounding: 0,
    })
    useRigStore.setState({
      cameraKind: 'path',
      lookAtMode: 'path-tangent',
      t: 0,
      roll: 0,
      rollKeys: [],
      staticPose: { position: [0, 0, 0], rotation: [0, 0, 0] },
    })
    const path = { anchors: lineAnchors(), rounding: 0 }
    const before = evaluateCinemaPose(
      0,
      path,
      cinemaChannelsFromRig(useRigStore.getState(), {
        objects: useSceneStore.getState().objects,
        paths: usePathStore.getState().paths,
      }),
    )!
    applyLookAtMode('free')
    expect(useRigStore.getState().lookAtMode).toBe('free')
    expect(useRigStore.getState().cameraKind).toBe('path')
    const after = evaluateCinemaPose(
      0,
      path,
      cinemaChannelsFromRig(useRigStore.getState(), {
        objects: useSceneStore.getState().objects,
        paths: usePathStore.getState().paths,
      }),
    )!
    const qa = new THREE.Quaternion(...before.quaternion)
    const qb = new THREE.Quaternion(...after.quaternion)
    expect(qa.angleTo(qb)).toBeLessThan(0.05)
  })
})
