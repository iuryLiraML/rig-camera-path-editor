export const SHOT_SCALES = ['ecu', 'cu', 'mcu', 'ms', 'ls', 'els', 'auto'] as const
export type ShotScale = (typeof SHOT_SCALES)[number]

export const SHOT_ANGLES = ['eye', 'low', 'high', 'top', 'dutch'] as const
export type ShotAngle = (typeof SHOT_ANGLES)[number]

export const MOVE_KINDS = [
  'orbit',
  'arc',
  'flyover',
  'dolly',
  'crane',
  'pan',
  'tilt',
  'zoom',
  'custom',
] as const
export type MoveKind = (typeof MOVE_KINDS)[number]

export const OBJECT_MOTION_KINDS = ['pose', 'spin', 'follow', 'path', 'clips'] as const
export type ObjectMotionKind = (typeof OBJECT_MOTION_KINDS)[number]

export type JudgeBlame = 'camera' | 'object'

export interface ShotPlan {
  intent: string
  subject_id: string
  duration_s: number
  move_kind: MoveKind
  shot_scale: ShotScale
  angle: ShotAngle
  take_name?: string
  object_motion?: { kind: ObjectMotionKind }
}

export interface JudgeFailure {
  code: string
  message: string
  blame: JudgeBlame
}

export interface JudgeMetrics {
  fillPct: Partial<Record<'0' | '0.5' | '1', number | null>>
  pathRadius: number | null
  diagonal: number | null
}

export interface JudgeReport {
  pass: boolean
  failures: JudgeFailure[]
  blame?: JudgeBlame
  metrics: JudgeMetrics
}

export interface VisionJudgeResult {
  pass: boolean
  fail_reason: string
  blame: JudgeBlame
}

export function fillRangeForScale(scale: ShotScale): { min: number; max: number } {
  switch (scale) {
    case 'ecu':
      return { min: 70, max: 95 }
    case 'cu':
      return { min: 45, max: 70 }
    case 'mcu':
      return { min: 30, max: 50 }
    case 'ms':
      return { min: 18, max: 35 }
    case 'ls':
      return { min: 8, max: 20 }
    case 'els':
      return { min: 3, max: 12 }
    case 'auto':
      return { min: 15, max: 70 }
    default: {
      const _never: never = scale
      return _never
    }
  }
}

/** Minimum camera-to-center distance as a multiple of the subject AABB diagonal. */
export function minRadiusFactor(scale: ShotScale): number {
  switch (scale) {
    case 'ecu':
      return 0.35
    case 'cu':
      return 0.55
    case 'mcu':
      return 0.9
    case 'ms':
      return 1.2
    case 'ls':
      return 1.8
    case 'els':
      return 2.5
    case 'auto':
      return 1.2
    default: {
      const _never: never = scale
      return _never
    }
  }
}

export function isShotScale(value: string): value is ShotScale {
  return (SHOT_SCALES as readonly string[]).includes(value)
}

export function isShotAngle(value: string): value is ShotAngle {
  return (SHOT_ANGLES as readonly string[]).includes(value)
}

export function isMoveKind(value: string): value is MoveKind {
  return (MOVE_KINDS as readonly string[]).includes(value)
}
