import { OFF_FLOOR_Y, THROUGH_FLOOR_Y } from '../floorSnap'
import { aabbFromCenterSize, distance, pathRadiusStats, pointInsideAabb, projectedFillPercent, type Aabb } from './framing'
import { fillRangeForScale, minRadiusFactor, type JudgeBlame, type JudgeFailure, type JudgeReport, type ShotPlan } from './shotTypes'
import type { Vec3 } from '../../state/useSceneStore'

export type CinemaSample = {
  t: number
  position: Vec3
  fov: number
  roll: number
  lookTarget: Vec3
}

export type JudgeInput = {
  plan: ShotPlan
  subject: Aabb | null
  samples: Array<CinemaSample | null>
  pathAnchors: Vec3[]
  aspect: number
}

export function judgeShot(input: JudgeInput): JudgeReport {
  const failures: JudgeFailure[] = []
  const fillPct: JudgeReport['metrics']['fillPct'] = {}

  if (hasNaN(input.pathAnchors) || input.samples.some((s) => s && hasNaN([s.position, s.lookTarget]))) {
    failures.push({
      code: 'nan',
      message: 'Path or camera sample contains NaN.',
      blame: 'camera',
    })
  }

  if (!input.subject) {
    failures.push({
      code: 'no_subject',
      message: 'No subject bounds to measure.',
      blame: 'object',
    })
    return finish(failures, { fillPct, pathRadius: null, diagonal: null })
  }

  const box = input.subject
  const floorY = box.min[1]
  if (floorY > OFF_FLOOR_Y) {
    failures.push({
      code: 'off_floor',
      message: `Subject sits at y=${floorY.toFixed(2)}; expected near the floor (y=0).`,
      blame: 'object',
    })
  }
  if (floorY < THROUGH_FLOOR_Y) {
    failures.push({
      code: 'through_floor',
      message: `Subject min y=${floorY.toFixed(2)} is below the floor.`,
      blame: 'object',
    })
  }

  const range = fillRangeForScale(input.plan.shot_scale)
  const mid = input.samples.find((s) => s && Math.abs(s.t - 0.5) < 1e-6) ?? input.samples[1]
  const ends = input.samples.filter((s) => s && (Math.abs(s.t) < 1e-6 || Math.abs(s.t - 1) < 1e-6))

  for (const sample of input.samples) {
    if (!sample) continue
    const key = sampleKey(sample.t)
    const fill = projectedFillPercent(
      box,
      sample.position,
      sample.lookTarget,
      sample.fov,
      input.aspect,
      sample.roll,
    )
    if (key) fillPct[key] = +fill.toFixed(1)
    if (pointInsideAabb(sample.position, box, 0.04)) {
      failures.push({
        code: 'inside_subject',
        message: `Camera is inside the subject at t=${sample.t}.`,
        blame: 'camera',
      })
    }
  }

  const primaryFill = mid
    ? projectedFillPercent(box, mid.position, mid.lookTarget, mid.fov, input.aspect, mid.roll)
    : null
  if (primaryFill !== null) {
    fillPct['0.5'] = +primaryFill.toFixed(1)
    if (primaryFill < range.min || primaryFill > range.max) {
      failures.push({
        code: 'framing',
        message: `Fill ${primaryFill.toFixed(0)}% at t=0.5; ${input.plan.shot_scale} needs ${range.min}–${range.max}%.`,
        blame: 'camera',
      })
    }
  }

  for (const sample of ends) {
    if (!sample) continue
    const fill = projectedFillPercent(
      box,
      sample.position,
      sample.lookTarget,
      sample.fov,
      input.aspect,
      sample.roll,
    )
    if (fill < range.min * 0.45) {
      failures.push({
        code: 'framing_end',
        message: `Fill ${fill.toFixed(0)}% at t=${sample.t}; subject barely in frame.`,
        blame: 'camera',
      })
    }
  }

  const positions = [
    ...input.pathAnchors,
    ...input.samples.filter((s): s is CinemaSample => s !== null).map((s) => s.position),
  ]
  const { median, max } = pathRadiusStats(positions, box.center)
  const minR = minRadiusFactor(input.plan.shot_scale) * Math.max(box.diagonal, 0.2)
  if (positions.length > 0 && median + 1e-6 < minR) {
    failures.push({
      code: 'path_scale',
      message: `Path radius ${median.toFixed(2)} < ${minR.toFixed(2)} (${input.plan.shot_scale} × diagonal).`,
      blame: 'camera',
    })
  }

  if (input.plan.angle === 'dutch') {
    const rolls = input.samples.filter((s): s is CinemaSample => s !== null).map((s) => Math.abs(s.roll))
    const peak = rolls.length ? Math.max(...rolls) : 0
    if (peak < 8) {
      failures.push({
        code: 'angle_dutch',
        message: `Dutch requested; roll is ${peak.toFixed(1)}° (need ≥ 8°).`,
        blame: 'camera',
      })
    }
  } else if (mid) {
    const camY = mid.position[1]
    const centerY = box.center[1]
    const height = Math.max(box.size[1], 0.2)
    switch (input.plan.angle) {
      case 'low':
        if (camY > box.min[1] + height * 0.45) {
          failures.push({
            code: 'angle_low',
            message: 'Low angle requested but the camera is not below the subject.',
            blame: 'camera',
          })
        }
        break
      case 'high':
        if (camY < centerY + height * 0.2) {
          failures.push({
            code: 'angle_high',
            message: 'High angle requested but the camera is not above the subject center.',
            blame: 'camera',
          })
        }
        break
      case 'top':
        if (camY < box.max[1] + height * 0.15) {
          failures.push({
            code: 'angle_top',
            message: 'Top-down requested but the camera is not above the subject.',
            blame: 'camera',
          })
        }
        break
      case 'eye':
        if (Math.abs(camY - centerY) > height * 0.85 && camY > box.max[1] + height) {
          failures.push({
            code: 'angle_eye',
            message: 'Eye-level requested but the camera is far above the subject.',
            blame: 'camera',
          })
        }
        break
      default: {
        const _never: never = input.plan.angle
        void _never
      }
    }
  }

  if (mid && input.plan.move_kind !== 'pan' && input.plan.move_kind !== 'tilt') {
    const lookDist = distance(mid.lookTarget, box.center)
    if (lookDist > Math.max(box.diagonal, 0.5) * 1.8) {
      failures.push({
        code: 'look_at',
        message: 'Look-at is far from the subject center.',
        blame: 'camera',
      })
    }
  }

  void max
  return finish(failures, {
    fillPct,
    pathRadius: positions.length ? +median.toFixed(3) : null,
    diagonal: +box.diagonal.toFixed(3),
  })
}

function sampleKey(t: number): '0' | '0.5' | '1' | null {
  if (Math.abs(t) < 1e-6) return '0'
  if (Math.abs(t - 0.5) < 1e-6) return '0.5'
  if (Math.abs(t - 1) < 1e-6) return '1'
  return null
}

function hasNaN(points: Vec3[]): boolean {
  return points.some((p) => p.some((n) => !Number.isFinite(n)))
}

function finish(failures: JudgeFailure[], metrics: JudgeReport['metrics']): JudgeReport {
  const unique = dedupe(failures)
  const blame = unique[0]?.blame
  return { pass: unique.length === 0, failures: unique, blame, metrics }
}

function dedupe(failures: JudgeFailure[]): JudgeFailure[] {
  const seen = new Set<string>()
  const out: JudgeFailure[] = []
  for (const f of failures) {
    if (seen.has(f.code)) continue
    seen.add(f.code)
    out.push(f)
  }
  return out
}

export function aabbFromCenterSizeForJudge(center: Vec3, size: Vec3): Aabb {
  return aabbFromCenterSize(center, size)
}

export function blameFromReport(report: JudgeReport): JudgeBlame {
  return report.blame ?? 'camera'
}
