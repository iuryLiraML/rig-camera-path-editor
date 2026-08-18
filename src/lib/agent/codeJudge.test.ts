import { describe, expect, it } from 'vitest'
import { aabbFromCenterSize, projectedFillPercent } from './framing'
import { judgeShot } from './codeJudge'
import {
  parseShotPlanFromText,
  planNeedsObjectPhase,
  resolveSubjectId,
  retargetPlanSubjectAfterLift,
} from './parseShotPlan'
import { fillRangeForScale } from './shotTypes'
import type { ShotPlan } from './shotTypes'
import type { Vec3 } from '../../state/useSceneStore'

const subject = aabbFromCenterSize([0, 1, 0], [1, 2, 1])

function plan(patch: Partial<ShotPlan> = {}): ShotPlan {
  return {
    intent: 'orbit',
    subject_id: 'obj-1',
    duration_s: 8,
    move_kind: 'orbit',
    shot_scale: 'auto',
    angle: 'eye',
    ...patch,
  }
}

function sample(t: number, position: Vec3, look: Vec3 = [0, 1, 0], fov = 40, roll = 0) {
  return { t, position, lookTarget: look, fov, roll }
}

describe('fillRangeForScale', () => {
  it('maps cu and auto to the locked bands', () => {
    expect(fillRangeForScale('cu')).toEqual({ min: 45, max: 70 })
    expect(fillRangeForScale('auto')).toEqual({ min: 15, max: 70 })
  })
})

describe('projectedFillPercent', () => {
  it('gives a larger fill when the camera is closer', () => {
    const far = projectedFillPercent(subject, [0, 1, 12], [0, 1, 0], 40, 16 / 9)
    const near = projectedFillPercent(subject, [0, 1, 3], [0, 1, 0], 40, 16 / 9)
    expect(near).toBeGreaterThan(far)
    expect(near).toBeGreaterThan(5)
  })
})

describe('judgeShot', () => {
  it('fails when the camera sits inside the subject', () => {
    const report = judgeShot({
      plan: plan(),
      subject,
      aspect: 16 / 9,
      pathAnchors: [[0, 1, 0], [0, 1, 0.1]],
      samples: [sample(0, [0, 1, 0]), sample(0.5, [0, 1, 0]), sample(1, [0, 1, 0])],
    })
    expect(report.pass).toBe(false)
    expect(report.failures.some((f) => f.code === 'inside_subject')).toBe(true)
    expect(report.blame).toBe('camera')
  })

  it('passes a distant orbit that fills the auto band', () => {
    const orbit: Vec3[] = [
      [4, 1.2, 0],
      [0, 1.2, 4],
      [-4, 1.2, 0],
      [0, 1.2, -4],
    ]
    const report = judgeShot({
      plan: plan({ shot_scale: 'auto' }),
      subject,
      aspect: 16 / 9,
      pathAnchors: orbit,
      samples: [
        sample(0, orbit[0]),
        sample(0.5, orbit[1]),
        sample(1, orbit[2]),
      ],
    })
    expect(report.failures.map((f) => f.code)).not.toContain('inside_subject')
    expect(report.failures.map((f) => f.code)).not.toContain('nan')
    expect(report.metrics.diagonal).toBeGreaterThan(0)
    expect(report.pass).toBe(true)
  })

  it('fails NaN path coordinates', () => {
    const report = judgeShot({
      plan: plan(),
      subject,
      aspect: 16 / 9,
      pathAnchors: [[Number.NaN, 1, 0], [2, 1, 0]],
      samples: [sample(0.5, [3, 1.2, 3])],
    })
    expect(report.pass).toBe(false)
    expect(report.failures[0]?.code).toBe('nan')
  })
})

describe('parseShotPlanFromText', () => {
  it('reads duration, orbit, close-up, and spin', () => {
    const parsed = parseShotPlanFromText('slow orbit around the bottle, 12s close-up, spin the product', 'obj-bottle')
    expect(parsed.duration_s).toBe(12)
    expect(parsed.move_kind).toBe('orbit')
    expect(parsed.shot_scale).toBe('cu')
    expect(parsed.object_motion?.kind).toBe('spin')
    expect(parsed.subject_id).toBe('obj-bottle')
  })

  it('maps Portuguese scale + push and duration', () => {
    const parsed = parseShotPlanFromText('primeiro plano + push, 6 segundos', 'obj-1')
    expect(parsed.shot_scale).toBe('cu')
    expect(parsed.move_kind).toBe('dolly')
    expect(parsed.duration_s).toBe(6)
  })

  it('maps Portuguese angle and crane', () => {
    const parsed = parseShotPlanFromText('plano geral em contrapicado com grua', 'obj-1')
    expect(parsed.shot_scale).toBe('ls')
    expect(parsed.angle).toBe('low')
    expect(parsed.move_kind).toBe('crane')
  })
})

describe('resolveSubjectId', () => {
  const objects = [
    { id: 'a', name: 'Bottle', area: 2, isFloorish: false },
    { id: 'b', name: 'Floor', area: 20, isFloorish: true },
  ]

  it('prefers a name mentioned in the prompt', () => {
    expect(resolveSubjectId('orbit the bottle', objects, null).subjectId).toBe('a')
  })

  it('uses outliner selection next', () => {
    expect(resolveSubjectId('make it cinematic', objects, 'a').subjectId).toBe('a')
  })

  it('flags two similarly large objects as ambiguous', () => {
    const pair = [
      { id: 'a', name: 'Hero', area: 2, isFloorish: false },
      { id: 'b', name: 'Other', area: 1.8, isFloorish: false },
    ]
    expect(resolveSubjectId('block a shot', pair, null).ambiguous).toBe(true)
  })
})

describe('retargetPlanSubjectAfterLift', () => {
  it('points the shot at the new figure, not the leftover primitive', () => {
    const plan = parseShotPlanFromText('pose the people from the photo', 'knot-1')
    const next = retargetPlanSubjectAfterLift(plan, new Set(['knot-1']), [
      { id: 'knot-1', name: 'Torus Knot', area: 4, isFloorish: false },
      { id: 'people-1', name: 'Group', area: 3, isFloorish: false },
    ])
    expect(next.subject_id).toBe('people-1')
  })
})

describe('planNeedsObjectPhase', () => {
  it('runs the object phase for a pose/people request', () => {
    const plan = parseShotPlanFromText('posa as pessoas', 'obj-1')
    expect(planNeedsObjectPhase(plan, 'posa as pessoas')).toBe(true)
    expect(planNeedsObjectPhase(plan, 'pose the people')).toBe(true)
    expect(planNeedsObjectPhase(plan, 'tenta posar as pessoas novamente')).toBe(true)
    expect(planNeedsObjectPhase(plan, 'lift a person from this video')).toBe(true)
  })

  it('does not treat a bare retry as an object phase', () => {
    const plan = parseShotPlanFromText('orbit the bottle again', 'obj-1')
    expect(plan.object_motion).toBeUndefined()
    expect(planNeedsObjectPhase(plan, 'orbit the bottle again')).toBe(false)
    expect(planNeedsObjectPhase(plan, 'try again')).toBe(false)
  })
})

describe('eval prompts (Slice 2)', () => {
  it('maps packshot CU orbit', () => {
    const parsed = parseShotPlanFromText('slow orbit around the product, 12s close-up', 'obj-1')
    expect(parsed.move_kind).toBe('orbit')
    expect(parsed.shot_scale).toBe('cu')
    expect(parsed.duration_s).toBe(12)
  })

  it('maps drone dive to flyover + high', () => {
    const parsed = parseShotPlanFromText('drone dive from above, fast', 'obj-1')
    expect(parsed.move_kind).toBe('flyover')
    expect(parsed.angle).toBe('high')
  })

  it('maps a reveal hold as an orbit', () => {
    const parsed = parseShotPlanFromText('orbit reveal with a hold on the hero angle', 'obj-1')
    expect(parsed.move_kind).toBe('orbit')
  })

  it('maps spin plus orbit to object motion', () => {
    const parsed = parseShotPlanFromText('spin the bottle and orbit it', 'obj-1')
    expect(parsed.move_kind).toBe('orbit')
    expect(parsed.object_motion?.kind).toBe('spin')
  })
})
