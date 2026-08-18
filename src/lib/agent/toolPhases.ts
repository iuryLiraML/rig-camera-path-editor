import type { ToolDef } from './providers'
import type { MoveKind } from './shotTypes'

export type CompilerPhase = 'object' | 'camera'

const OBJECT_TOOLS = new Set([
  'load_skill',
  'measure_subject',
  'pose_object',
  'add_pose_keyframe',
  'update_pose_keyframe',
  'remove_pose_keyframe',
  'apply_spin',
  'clear_object_animation',
  'set_follow_path',
  'create_object_path',
  'set_object_path',
  'set_object_clips',
  'add_primitive',
  'block_people_from_image',
  'generate_prop',
  'set_playhead',
])

const CAMERA_TOOLS = new Set([
  'load_skill',
  'measure_subject',
  'instantiate_atom',
  'begin_camera_option',
  'switch_camera_option',
  'apply_camera_preset',
  'set_camera_path',
  'set_path_params',
  'set_camera_keyframes',
  'set_look_at',
  'set_camera_noise',
  'set_lens',
  'set_output_format',
  'save_shot',
  'play_preview',
  'set_playhead',
])

export function toolsForPhase(
  all: ToolDef[],
  phase: CompilerPhase,
  plan?: { move_kind: MoveKind },
): ToolDef[] {
  const allow = phase === 'object' ? OBJECT_TOOLS : CAMERA_TOOLS
  return all.filter((t) => {
    if (!allow.has(t.name)) return false
    if (phase === 'camera' && t.name === 'set_camera_path' && plan?.move_kind !== 'custom') {
      return false
    }
    return true
  })
}

export function phaseStatus(phase: CompilerPhase): string {
  switch (phase) {
    case 'object':
      return 'Placing…'
    case 'camera':
      return 'Blocking camera…'
    default: {
      const _never: never = phase
      return _never
    }
  }
}
