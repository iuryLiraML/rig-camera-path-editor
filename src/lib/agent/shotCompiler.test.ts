import { describe, expect, it } from 'vitest'
import { AGENT_SKILLS, skillNameForPlan } from './skills'
import { liftToolFailure, objectPhaseInstruction } from './shotCompiler'
import { toolsForPhase } from './toolPhases'
import { failChipsFor, parseVisionJudge } from './visionJudge'
import type { AgentMessage, ToolDef } from './providers'

const all: ToolDef[] = [
  { name: 'create_object_path', description: '', input_schema: {} },
  { name: 'set_camera_path', description: '', input_schema: {} },
  { name: 'pose_object', description: '', input_schema: {} },
  { name: 'play_preview', description: '', input_schema: {} },
  { name: 'load_skill', description: '', input_schema: {} },
]

describe('skill index', () => {
  it('ships cinematography skills plus photo and video lift', () => {
    expect(AGENT_SKILLS.map((s) => s.name)).toEqual([
      'shot-grammar',
      'packshot',
      'commercial-beauty',
      'cinema-basics',
      'drone',
      'handheld',
      'orbit-reveal',
      'dolly-push',
      'photo-lift',
      'set-blocking',
    ])
  })
})

describe('toolsForPhase', () => {
  it('keeps object paths out of the camera phase and hides set_camera_path unless custom', () => {
    expect(toolsForPhase(all, 'camera').map((t) => t.name)).toEqual([
      'play_preview',
      'load_skill',
    ])
    expect(toolsForPhase(all, 'camera', { move_kind: 'custom' }).map((t) => t.name)).toEqual([
      'set_camera_path',
      'play_preview',
      'load_skill',
    ])
  })

  it('keeps camera path out of the object phase', () => {
    expect(toolsForPhase(all, 'object').map((t) => t.name)).toEqual([
      'create_object_path',
      'pose_object',
      'load_skill',
    ])
  })

  it('allows the people lift tool only in the object phase', () => {
    const defs: ToolDef[] = [
      { name: 'block_people_from_image', description: '', input_schema: {} },
      { name: 'set_camera_path', description: '', input_schema: {} },
    ]
    expect(toolsForPhase(defs, 'object').map((t) => t.name)).toEqual(['block_people_from_image'])
    expect(toolsForPhase(defs, 'camera', { move_kind: 'custom' }).map((t) => t.name)).toEqual([
      'set_camera_path',
    ])
    expect(toolsForPhase(defs, 'camera', { move_kind: 'orbit' }).map((t) => t.name)).toEqual([])
  })
})

describe('objectPhaseInstruction', () => {
  it('routes an attached still to block_people_from_image on cycle 0', () => {
    const still = objectPhaseInstruction({
      hasImage: true,
      cycle: 0,
      subjectId: 'knot-1',
    })
    expect(still).toContain('block_people_from_image')
    const later = objectPhaseInstruction({
      hasImage: true,
      cycle: 1,
      subjectId: 'knot-1',
    })
    expect(later).toContain('knot-1')
  })
})

describe('vision judge parse', () => {
  it('reads a failing JSON blob', () => {
    const parsed = parseVisionJudge('notes\n{"pass":false,"fail_reason":"empty frame","blame":"camera"}')
    expect(parsed).toEqual({ pass: false, fail_reason: 'empty frame', blame: 'camera' })
  })

  it('fails closed when the model omits JSON', () => {
    expect(parseVisionJudge('looks fine')).toMatchObject({
      pass: false,
      fail_reason: 'Vision judge returned no JSON.',
      blame: 'camera',
    })
  })

  it('fails closed on invalid JSON', () => {
    expect(parseVisionJudge('{pass:true}')).toMatchObject({ pass: false, blame: 'camera' })
  })
})

describe('failChipsFor', () => {
  it('offers Closer on framing fails', () => {
    expect(failChipsFor(['framing'])).toContain('Closer')
  })

  it('maps path scale and look-at to Wider / Track subject', () => {
    expect(failChipsFor(['path_scale'])).toContain('Wider')
    expect(failChipsFor(['look_at'])).toContain('Track subject')
    expect(failChipsFor(['angle_low'])).toContain('Lower')
  })
})

describe('skillNameForPlan', () => {
  it('picks packshot, dolly-push, and drone from the plan', () => {
    expect(
      skillNameForPlan({
        intent: 'slow orbit around the product',
        subject_id: 'o',
        duration_s: 12,
        move_kind: 'orbit',
        shot_scale: 'cu',
        angle: 'eye',
      }),
    ).toBe('packshot')
    expect(
      skillNameForPlan({
        intent: 'primeiro plano + push',
        subject_id: 'o',
        duration_s: 6,
        move_kind: 'dolly',
        shot_scale: 'cu',
        angle: 'eye',
      }),
    ).toBe('dolly-push')
    expect(
      skillNameForPlan({
        intent: 'drone dive from above',
        subject_id: 'o',
        duration_s: 8,
        move_kind: 'flyover',
        shot_scale: 'auto',
        angle: 'high',
      }),
    ).toBe('drone')
  })
})

describe('liftToolFailure', () => {
  it('returns the English lift error and ignores a successful place', () => {
    const error: AgentMessage = {
      role: 'tool',
      toolCallId: '1',
      name: 'block_people_from_image',
      content:
        'Error: The lift finished but the GLB could not be imported. Try a clearer photo of the subject.',
    }
    expect(liftToolFailure([error])).toMatch(/GLB/)
    expect(
      liftToolFailure([
        error,
        {
          role: 'tool',
          toolCallId: '2',
          name: 'block_people_from_image',
          content: 'Placed Person (obj-1) on the floor.',
        },
      ]),
    ).toBeNull()
  })

  it('treats a non-Error lift miss as a hard stop', () => {
    expect(
      liftToolFailure([
        {
          role: 'tool',
          toolCallId: '1',
          name: 'block_people_from_image',
          content: 'Attach a photo in the chat, then ask again.',
        },
      ]),
    ).toMatch(/Attach a photo/)
  })

  it('does not halt on pose tools or a prior turn', () => {
    expect(
      liftToolFailure([
        {
          role: 'tool',
          toolCallId: '1',
          name: 'pose_object',
          content: 'Error: No object with id "x".',
        },
      ]),
    ).toBeNull()
    expect(liftToolFailure([])).toBeNull()
  })
})
