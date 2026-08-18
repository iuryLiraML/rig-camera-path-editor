import type { VisionJudgeResult } from './shotTypes'

const VISION_PROMPT = `You are a silent shot checker. You receive three stills in order: start (t=0), mid (t=0.5), end (t=1). Look at all three. Answer with JSON only:
{"pass":true|false,"fail_reason":"short reason or empty","blame":"camera"|"object"}
Pass if: the subject is visible and recognizable in every still; the move roughly matches the intent; nothing is grossly broken (camera inside the mesh, empty frame).
Do not score beauty, mood, or rule-of-thirds.`

export function visionJudgeSystemPrompt(): string {
  return VISION_PROMPT
}

export function parseVisionJudge(text: string): VisionJudgeResult {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) {
    return { pass: false, fail_reason: 'Vision judge returned no JSON.', blame: 'camera' }
  }
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>
    const pass = parsed.pass === true
    const blame = parsed.blame === 'object' ? 'object' : 'camera'
    const fail_reason = typeof parsed.fail_reason === 'string' ? parsed.fail_reason : ''
    return { pass, fail_reason, blame }
  } catch {
    return { pass: false, fail_reason: 'Vision judge returned invalid JSON.', blame: 'camera' }
  }
}

export function failChipsFor(codes: string[]): string[] {
  const chips: string[] = []
  if (codes.some((c) => c === 'framing' || c === 'framing_end' || c === 'inside_subject')) {
    chips.push('Closer')
  }
  if (codes.includes('path_scale')) chips.push('Wider')
  if (codes.includes('angle_low')) chips.push('Lower')
  if (codes.includes('angle_high') || codes.includes('angle_top')) chips.push('Higher')
  if (codes.includes('look_at')) chips.push('Track subject')
  if (codes.some((c) => c === 'off_floor' || c === 'through_floor')) {
    chips.push('Sit on floor')
  }
  if (chips.length === 0) chips.push('Closer', 'Wider')
  return [...new Set(chips)].slice(0, 3)
}
