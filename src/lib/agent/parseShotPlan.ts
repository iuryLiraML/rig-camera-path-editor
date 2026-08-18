import {
  isMoveKind,
  isShotAngle,
  isShotScale,
  type MoveKind,
  type ObjectMotionKind,
  type ShotAngle,
  type ShotPlan,
  type ShotScale,
} from './shotTypes'

const DURATION_RE = /(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds|segundo|segundos|seg)\b/i

export type SubjectCandidate = {
  id: string
  name: string
  area: number
  isFloorish: boolean
}

/**
 * D28: named in prompt → outliner selection → largest AABB above the floor.
 * Ambiguous when two large objects are close in size and nothing named them.
 */
export function resolveSubjectId(
  prompt: string,
  objects: SubjectCandidate[],
  selectionId: string | null,
): { subjectId: string | null; ambiguous: boolean } {
  const named = objects.find((o) => {
    const name = o.name.trim().toLowerCase()
    if (name.length < 2) return false
    return prompt.toLowerCase().includes(name)
  })
  if (named) return { subjectId: named.id, ambiguous: false }

  if (selectionId) {
    const selected = objects.find((o) => o.id === selectionId)
    if (selected) return { subjectId: selected.id, ambiguous: false }
  }

  const usable = objects.filter((o) => !o.isFloorish && o.area > 0.05)
  if (usable.length === 0) return { subjectId: objects[0]?.id ?? null, ambiguous: false }
  const ranked = [...usable].sort((a, b) => b.area - a.area)
  const top = ranked[0]
  const runner = ranked[1]
  if (runner && runner.area > top.area * 0.7) {
    return { subjectId: null, ambiguous: true }
  }
  return { subjectId: top.id, ambiguous: false }
}

/** ASCII fold so PT accents do not break `\\b` (ó is not a JS word char). */
function foldPt(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '')
}

export function parseShotPlanFromText(text: string, subjectId: string): ShotPlan {
  const lower = foldPt(text.toLowerCase())
  return {
    intent: text.trim().slice(0, 240) || 'Block a shot.',
    subject_id: subjectId,
    duration_s: parseDuration(text),
    move_kind: parseMoveKind(lower),
    shot_scale: parseScale(lower),
    angle: parseAngle(lower),
    object_motion: parseObjectMotion(lower),
  }
}

function parseDuration(text: string): number {
  const match = text.match(DURATION_RE)
  if (!match) return 8
  const seconds = Number(match[1])
  if (!Number.isFinite(seconds)) return 8
  return Math.min(30, Math.max(1, seconds))
}

function parseMoveKind(lower: string): MoveKind {
  if (/\b(orbit|orbita|orbitar|turntable|360|volta de 360|em volta|ao redor)\b/.test(lower)) {
    return 'orbit'
  }
  if (/\b(arc|arco|half[- ]?orbit|meia[- ]?orbita)\b/.test(lower)) return 'arc'
  if (/\b(flyover|fly[- ]over|overfly|sobrevoo|passa por cima)\b/.test(lower)) return 'flyover'
  if (/\b(aproxima(?:r)? a lente|zoom)\b/.test(lower)) return 'zoom'
  if (
    /\b(dolly|push[- ]?in|pull[- ]?back|creep|push|aproxima(?:r)?|avancar|recua(?:r)?|afasta(?:r)?)\b/.test(
      lower,
    )
  ) {
    return 'dolly'
  }
  if (/\b(crane|jib|rise|pedestal|grua|sobe a (?:camera|camara))\b/.test(lower)) return 'crane'
  if (/\b(pan|panear|varre|varredura)\b/.test(lower)) return 'pan'
  if (/\b(tilt|inclina(?:r)?)\b/.test(lower)) return 'tilt'
  if (/\b(dive|drone|fpv|mergulho)\b/.test(lower)) return 'flyover'
  if (/\b(custom|livre|personalizad[oa])\b/.test(lower)) return 'custom'
  return 'orbit'
}

function parseScale(lower: string): ShotScale {
  if (/\b(ecu|extreme close[- ]?up|primerissimo(?: plano)?|primeiro plano extremo)\b/.test(lower)) {
    return 'ecu'
  }
  if (/\b(cu|close[- ]?up|primeiro plano)\b/.test(lower)) return 'cu'
  if (/\b(mcu|medium close[- ]?up|plano medio proximo|plano americano)\b/.test(lower)) {
    return 'mcu'
  }
  if (/\b(ms|medium shot|plano medio)\b/.test(lower)) return 'ms'
  if (/\b(els|extreme (?:long|wide)|establishing|plano geral aberto)\b/.test(lower)) return 'els'
  if (/\b(ls|long shot|wide shot|plano geral|plano conjunto)\b/.test(lower)) return 'ls'
  if (/\b(packshot|product|produto)\b/.test(lower)) return 'mcu'
  if (isShotScale(lower)) return lower
  return 'auto'
}

function parseAngle(lower: string): ShotAngle {
  if (/\b(dutch|holandes|inclinado)\b/.test(lower)) return 'dutch'
  if (/\b(top[- ]down|overhead|bird.?eye|flat[- ]lay|zenital|plongee)\b/.test(lower)) return 'top'
  if (/\b(contrapicado|low[- ]angle|from below|low angle|de baixo)\b/.test(lower)) return 'low'
  if (/\b(picado|high[- ]angle|from above|high angle|de cima)\b/.test(lower)) return 'high'
  if (isShotAngle(lower)) return lower
  return 'eye'
}

function parseObjectMotion(lower: string): { kind: ObjectMotionKind } | undefined {
  if (/\b(spin|gira(?:r)?|roda(?:r)?|rodopia(?:r)?|rotate(?:s| the product)?)\b/.test(lower)) {
    return { kind: 'spin' }
  }
  if (/\b(follow|segue|seguir|rides? the path)\b/.test(lower)) return { kind: 'follow' }
  if (/\b(clips?|play(?:s)? the animation)\b/.test(lower)) return { kind: 'clips' }
  if (/\b(animate|anima(?:r)?|keyframe)\b/.test(lower)) return { kind: 'pose' }
  return undefined
}

export function planNeedsObjectPhase(plan: ShotPlan, userText: string): boolean {
  if (plan.object_motion) return true
  return /\b(lift|attach|photo|foto|video|clip|person|people|pessoa|pessoas|prop|generate|pose|posa|posar)\b/i.test(
    userText,
  )
}

/** After a photo lift, the new GLB is the shot subject — not a leftover primitive. */
export function retargetPlanSubjectAfterLift(
  plan: ShotPlan,
  beforeIds: ReadonlySet<string>,
  objects: SubjectCandidate[],
): ShotPlan {
  const added = objects.filter((o) => !beforeIds.has(o.id) && !o.isFloorish)
  if (added.length === 0) return plan
  const top = [...added].sort((a, b) => b.area - a.area)[0]
  return { ...plan, subject_id: top.id }
}

export { isMoveKind, isShotAngle, isShotScale }
