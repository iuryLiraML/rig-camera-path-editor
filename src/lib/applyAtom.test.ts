import { beforeEach, describe, expect, it } from 'vitest'
import { aabbFromCenterSize } from './agent/framing'
import { judgeShot } from './agent/codeJudge'
import { cinemaChannelsFromRig } from './cinemaChannels'
import { evaluateCinemaPose } from './evaluateCinemaPose'
import { applyAtomPath, atomFromSubject } from './applyAtom'
import { executeTool } from './agent/tools'
import { CAMERA_PATH_ID, usePathStore } from '../state/usePathStore'
import { useRigStore } from '../state/useRigStore'
import type { ShotPlan } from './agent/shotTypes'

const subject = aabbFromCenterSize([0, 1, 0], [1, 2, 1])

beforeEach(() => {
  usePathStore.setState({
    paths: [{ id: CAMERA_PATH_ID, name: 'Camera Path', anchors: [], closed: false, rounding: 0.8 }],
    activePathId: CAMERA_PATH_ID,
  })
  useRigStore.setState({
    cameraPathId: CAMERA_PATH_ID,
    cameraKind: 'path',
    fovKeys: [],
    progressKeys: [],
    roll: 0,
    fov: 45,
  })
})

function plan(scale: ShotPlan['shot_scale'] = 'cu'): ShotPlan {
  return {
    intent: 'orbit',
    subject_id: 'hero',
    duration_s: 8,
    move_kind: 'orbit',
    shot_scale: scale,
    angle: 'eye',
  }
}

describe('applyAtomPath', () => {
  it('writes a CU orbit that the code judge accepts', () => {
    const atom = atomFromSubject({ kind: 'orbit', subject, scale: 'cu', angle: 'eye', aspect: 16 / 9 })
    applyAtomPath(atom, 8)
    const path = usePathStore.getState().getPath(CAMERA_PATH_ID)
    expect(path?.anchors.length).toBeGreaterThanOrEqual(2)

    const rig = useRigStore.getState()
    const channels = cinemaChannelsFromRig(rig, { objects: [], paths: usePathStore.getState().paths })
    const pathInput = {
      anchors: path!.anchors,
      closed: path!.closed,
      rounding: path!.rounding,
    }
    const samples = [0, 0.5, 1].map((t) => {
      const pose = evaluateCinemaPose(t, pathInput, channels)
      if (!pose) return null
      return { t, position: pose.position, fov: pose.fov, roll: rig.roll, lookTarget: pose.lookTarget }
    })
    const report = judgeShot({
      plan: plan('cu'),
      subject,
      samples,
      pathAnchors: path!.anchors.map((a) => a.position),
      aspect: 16 / 9,
    })
    expect(report.failures.map((f) => f.code)).toEqual([])
    expect(report.pass).toBe(true)
    expect(report.metrics.fillPct['0.5']).toBeGreaterThanOrEqual(45)
    expect(report.metrics.fillPct['0.5']).toBeLessThanOrEqual(70)
  })
})

describe('set_camera_path gate', () => {
  it('refuses raw XYZ unless custom=true', async () => {
    const denied = await executeTool('set_camera_path', {
      anchors: [
        [1, 1, 1],
        [2, 1, 2],
      ],
      closed: false,
    })
    expect(denied).toMatch(/instantiate_atom/)
    const allowed = await executeTool('set_camera_path', {
      anchors: [
        [1, 1, 1],
        [2, 1, 2],
      ],
      closed: false,
      custom: true,
    })
    expect(allowed).toMatch(/Camera path set/)
  })
})
