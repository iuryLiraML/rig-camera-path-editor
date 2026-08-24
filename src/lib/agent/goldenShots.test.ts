import { beforeEach, describe, expect, it } from 'vitest'
import { aabbFromCenterSize } from './framing'
import { judgeShot } from './codeJudge'
import { cinemaChannelsFromRig } from '../cinemaChannels'
import { evaluateCinemaPose } from '../evaluateCinemaPose'
import { applyAtomPath, atomFromSubject, parseAtomKind } from '../applyAtom'
import { parseShotPlanFromText } from './parseShotPlan'
import { CAMERA_PATH_ID, usePathStore } from '../../state/usePathStore'
import { useRigStore } from '../../state/useRigStore'
import type { ShotPlan } from './shotTypes'

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

function judgeApplied(plan: ShotPlan) {
  const kind = parseAtomKind(plan.move_kind === 'custom' ? 'orbit' : plan.move_kind)
  if (!kind) throw new Error(`no atom for ${plan.move_kind}`)
  const atom = atomFromSubject({
    kind,
    subject,
    scale: plan.shot_scale,
    angle: plan.angle,
    aspect: 16 / 9,
  })
  applyAtomPath(atom, plan.duration_s)
  const path = usePathStore.getState().getPath(CAMERA_PATH_ID)
  if (!path) throw new Error('missing camera path')
  const rig = useRigStore.getState()
  const channels = cinemaChannelsFromRig(rig, { objects: [], paths: usePathStore.getState().paths })
  const pathInput = { anchors: path.anchors, closed: path.closed, rounding: path.rounding }
  const samples = [0, 0.5, 1].map((t) => {
    const pose = evaluateCinemaPose(t, pathInput, channels)
    if (!pose) return null
    return { t, position: pose.position, fov: pose.fov, roll: rig.roll, lookTarget: pose.lookTarget }
  })
  return judgeShot({
    plan,
    subject,
    samples,
    pathAnchors: path.anchors.map((a) => a.position),
    aspect: 16 / 9,
  })
}

const CASES: Array<{ prompt: string; scale: ShotPlan['shot_scale']; kind: ShotPlan['move_kind'] }> = [
  { prompt: 'slow orbit around the product, 12s close-up', scale: 'cu', kind: 'orbit' },
  { prompt: 'primeiro plano + push', scale: 'cu', kind: 'dolly' },
  { prompt: 'drone dive from above, fast', scale: 'auto', kind: 'flyover' },
  { prompt: 'orbit reveal with a hold on the hero angle', scale: 'auto', kind: 'orbit' },
  { prompt: 'spin the bottle and orbit it', scale: 'auto', kind: 'orbit' },
]

describe('golden shots (parse → atom → judge)', () => {
  it.each(CASES)('$prompt', ({ prompt, scale, kind }) => {
    const plan = parseShotPlanFromText(prompt, 'hero')
    expect(plan.move_kind).toBe(kind)
    expect(plan.shot_scale).toBe(scale)
    const report = judgeApplied(plan)
    expect(report.failures.map((f) => f.code)).toEqual([])
    expect(report.pass).toBe(true)
  })
})
