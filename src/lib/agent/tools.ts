import * as THREE from 'three'
import type { ToolDef } from './providers'
import { AGENT_SKILLS, getSkill } from './skills'
import { useRigStore } from '../../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore } from '../../state/usePathStore'
import { cameraPath, cameraReady } from '../../state/cameraPathLink'
import { defaultFollow, useSceneStore, type Vec3 } from '../../state/useSceneStore'
import { useEditorStore } from '../../state/useEditorStore'
import { useProjectStore } from '../../state/useProjectStore'
import { applyCameraPreset } from '../presets'
import {
  applyAtomPath,
  atomFromSubject,
  followedPathId,
  formatAtomResult,
  mutateFollowedPath,
  parseAngleInput,
  parseAtomKind,
  parseScaleInput,
} from '../applyAtom'
import { subjectAabb, selectedObjectId, objectCandidates } from './sceneSnapshot'
import { applyBeginPlayback } from '../playback'
import { saveCurrentAsShot } from '../projects'
import { objectGroups } from '../../viewport/SceneObjects'
import { renderBridge } from '../renderBridge'
import type { ExportAspect, ExportRes } from '../../state/useEditorStore'
import {
  beginGeneratedCameraOption,
  getCameraOptionsSnapshot,
  useCameraOptionsStore,
} from '../../state/useCameraOptionsStore'
import { setCameraPathSpace, setTrackObjectId } from '../pathSpaceBind'
import { getLiftAttachment } from '../fal/attachment'
import { liftAttachedStill } from '../fal/pipeline'
import { readFalSettings } from '../fal/settings'
import { importModelBuffer } from '../sceneIO'
import {
  asPrimitiveKind,
  asPrimitiveRole,
  configurePlacedPrimitive,
  snapObjectToFloor,
  snapSceneToFloor,
} from '../floorSnap'

const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'load_skill',
    description: 'Load the full body of a built-in cinematography skill before using its recipes.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Skill name from the index in the system prompt' } },
      required: ['name'],
    },
  },
  {
    name: 'begin_camera_option',
    description:
      'Start a new named camera alternative without replacing existing cameras. Call this before building EACH option when the user requests alternatives.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Short descriptive camera name, e.g. "Low Chase", "Hero Orbit", or "Top Flyover"',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'switch_camera_option',
    description: 'Select an existing named camera option so it can be viewed or edited.',
    input_schema: {
      type: 'object',
      properties: {
        camera_id: { type: 'string', description: 'Camera option id from scene_state.camera_options' },
      },
      required: ['camera_id'],
    },
  },
  {
    name: 'measure_subject',
    description:
      'Read the subject AABB (center, size, diagonal) and suggested camera radius per shot scale. Call before inventing any metres.',
    input_schema: {
      type: 'object',
      properties: { object_id: { type: 'string', description: 'Scene object id from scene_state' } },
      required: ['object_id'],
    },
  },
  {
    name: 'instantiate_atom',
    description:
      'Build a cinematic camera atom (orbit, dolly, …) sized from the subject bounds so framing hits the shot_scale fill band. Prefer this over set_camera_path.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['orbit', 'arc', 'flyover', 'dolly', 'crane', 'pan', 'tilt', 'zoom'] },
        subject_id: { type: 'string', description: 'Subject object id from the ShotPlan' },
        scale: { type: 'string', enum: ['ecu', 'cu', 'mcu', 'ms', 'ls', 'els', 'auto'] },
        angle: { type: 'string', enum: ['eye', 'low', 'high', 'top', 'dutch'] },
        duration: { type: 'number', description: 'Clip length in seconds (1..30)' },
      },
      required: ['kind', 'subject_id'],
    },
  },
  {
    name: 'apply_camera_preset',
    description:
      'Same as instantiate_atom. Pass subject_id and scale so the path is sized from the subject, not the whole scene.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['orbit', 'arc', 'flyover', 'dolly', 'crane', 'pan', 'tilt', 'zoom'] },
        subject_id: { type: 'string' },
        scale: { type: 'string', enum: ['ecu', 'cu', 'mcu', 'ms', 'ls', 'els', 'auto'] },
        angle: { type: 'string', enum: ['eye', 'low', 'high', 'top', 'dutch'] },
        duration: { type: 'number' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'set_camera_path',
    description:
      'Custom paths only (ShotPlan.move_kind=custom). Pass custom=true. For named moves use instantiate_atom — do not invent XYZ.',
    input_schema: {
      type: 'object',
      properties: {
        anchors: { type: 'array', items: vec3, minItems: 2, description: 'Anchor positions [x,y,z]' },
        closed: { type: 'boolean', description: 'Close the path into a loop' },
        custom: { type: 'boolean', description: 'Must be true. Confirms this is a custom move, not an atom.' },
      },
      required: ['anchors', 'closed', 'custom'],
    },
  },
  {
    name: 'set_path_params',
    description: 'Tune path/animation parameters. Only include the fields you want to change.',
    input_schema: {
      type: 'object',
      properties: {
        rounding: { type: 'number', description: 'Curve rounding 0..1 (0 = straight segments)' },
        height: { type: 'number', description: 'Uniform path height in world units (flattens all anchors)' },
        duration: { type: 'number', description: 'Animation duration in seconds (1..30)' },
        smoothness: { type: 'number', description: 'Speed easing 0..1 (0 = constant speed)' },
        loop: { type: 'boolean' },
      },
    },
  },
  {
    name: 'set_camera_keyframes',
    description:
      'Pin where along the path the camera is at given times. Each key: time (0..1 of duration) -> progress (0..1 of path). Implicit endpoints 0->0 and 1->1 fill the rest. Two keys with the same progress = hold. Replaces all existing keys.',
    input_schema: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: {
            type: 'object',
            properties: { time: { type: 'number' }, progress: { type: 'number' } },
            required: ['time', 'progress'],
          },
        },
      },
      required: ['keys'],
    },
  },
  {
    name: 'set_look_at',
    description:
      'Where the camera looks, and whether the path is world-space or rides with a tracked object (relative camera: chase, over-shoulder, hood-mount). Optional offset is local to the tracked object.',
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['target', 'motion'] },
        target: { ...vec3, description: 'World position (mode=target, when not tracking an object)' },
        object_id: {
          type: 'string',
          description: 'Scene object to track / parent the path to. Empty to use a fixed point.',
        },
        offset: {
          ...vec3,
          description:
            'Local XYZ offset from the tracked object origin (head, label, over-shoulder). Omit on the same object to keep the current offset; a new object without offset uses the object center.',
        },
        path_space: {
          type: 'string',
          enum: ['world', 'object'],
          description:
            'object = path is in the tracked object\'s local space (requires object_id or an existing track).',
        },
      },
      required: ['mode'],
    },
  },
  {
    name: 'set_camera_noise',
    description:
      'Enable or tune the camera shake clip. Prefer style + intensity + start/end + fades — do NOT write pose or path keyframes to fake handheld. Same seed always produces the same motion.',
    input_schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        style: {
          type: 'string',
          enum: ['shake', 'handheld', 'rumble'],
          description: 'shake = mid jitter; handheld = slower, rotation-heavy; rumble = low, position-heavy',
        },
        intensity: { type: 'number', description: 'Master gain 0..1' },
        start: { type: 'number', description: 'Window start as 0..1 of the shot' },
        end: { type: 'number', description: 'Window end as 0..1 of the shot' },
        fade_in: { type: 'number', description: 'Fade-in length in seconds' },
        fade_out: { type: 'number', description: 'Fade-out length in seconds' },
        amp_pos: { type: 'number', description: 'Override position jitter in world units (0..0.2)' },
        amp_rot: { type: 'number', description: 'Override rotation jitter in degrees (0..8)' },
        freq: { type: 'number', description: 'Override frequency (0.5..12)' },
        seed: { type: 'number' },
      },
    },
  },
  {
    name: 'set_follow_path',
    description:
      'Attach an object to a motion path, or detach it (path_id empty). Uses the existing follow settings: align, offset, height, bank, loops.',
    input_schema: {
      type: 'object',
      properties: {
        object_id: { type: 'string' },
        path_id: { type: 'string', description: 'Path id from scene_state, or empty to detach' },
        align: { type: 'boolean' },
        offset: { type: 'number', description: 'Start along the path 0..1' },
        height: { type: 'number' },
        bank: { type: 'number', description: 'Roll in degrees when align is true' },
        loops: { type: 'number' },
      },
      required: ['object_id'],
    },
  },
  {
    name: 'set_lens',
    description: 'Camera lens settings. Only include the fields you want to change.',
    input_schema: {
      type: 'object',
      properties: {
        fov: { type: 'number', description: 'Field of view in degrees (15..120)' },
        roll: { type: 'number', description: 'Camera roll in degrees (-180..180)' },
      },
    },
  },
  {
    name: 'pose_object',
    description:
      "Move, rotate, or scale a scene object. Position Y is feet on the floor unless lift=true — do not pass the AABB center Y. After a group photo lift, each Person N is its own id — pose them separately. Never pose a leftover primitive. Only include the parts you want to change. Cannot change a figure's body articulation; that pose comes from the photo.",
    input_schema: {
      type: 'object',
      properties: {
        object_id: { type: 'string' },
        position: vec3,
        rotation: { ...vec3, description: 'Euler XYZ in degrees' },
        scale: vec3,
        lift: {
          type: 'boolean',
          description: 'If true, honor position Y and do not snap feet to the floor',
        },
      },
      required: ['object_id'],
    },
  },
  {
    name: 'add_pose_keyframe',
    description: "Save the object's CURRENT pose as a keyframe at a time (0..1). Pose first with pose_object, then keyframe.",
    input_schema: {
      type: 'object',
      properties: { object_id: { type: 'string' }, time: { type: 'number' } },
      required: ['object_id', 'time'],
    },
  },
  {
    name: 'apply_spin',
    description: 'Give an object a full 360-degree Y turn over the whole timeline (replaces its pose keyframes).',
    input_schema: { type: 'object', properties: { object_id: { type: 'string' } }, required: ['object_id'] },
  },
  {
    name: 'clear_object_animation',
    description: 'Remove all pose keyframes from an object.',
    input_schema: { type: 'object', properties: { object_id: { type: 'string' } }, required: ['object_id'] },
  },
  {
    name: 'set_playhead',
    description: 'Move the timeline playhead (0..1) to inspect a moment.',
    input_schema: { type: 'object', properties: { t: { type: 'number' } }, required: ['t'] },
  },
  {
    name: 'play_preview',
    description: 'Start playback from the beginning so the user watches the move.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_output_format',
    description:
      'Set the output aspect ratio and resolution for exports and generation (e.g. 9:16 for reels/TikTok, 1:1 for feed, 16:9 for YouTube).',
    input_schema: {
      type: 'object',
      properties: {
        aspect: { type: 'string', enum: ['16:9', '1:1', '9:16'] },
        resolution: { type: 'string', enum: ['720', '1080'], description: '720p or 1080p' },
      },
    },
  },
  {
    name: 'save_shot',
    description:
      'Snapshot the current camera move as a shot on the storyboard Board. Use after building a move the user is happy with, or when building several shots in a row.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'add_primitive',
    description:
      'Add a clay shape for set blocking (pedestals, walls, floors, props). Position is feet on the floor at y=0 — never pass half-height as Y. bounds.center in scene_state is not the pose origin. Use role=wall for a standing wall, role=floor for a ground plane.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus'] },
        position: {
          ...vec3,
          description: 'World XZ (and Y only with lift=true). Default origin on the floor.',
        },
        size: {
          ...vec3,
          description: 'Width, height, depth in world units (optional)',
        },
        role: {
          type: 'string',
          enum: ['prop', 'wall', 'floor'],
          description: 'wall stands on the floor; floor is a large ground plane; prop is a regular shape',
        },
        lift: {
          type: 'boolean',
          description: 'If true, honor position Y and do not snap feet to the floor',
        },
      },
      required: ['kind'],
    },
  },
  {
    name: 'block_people_from_image',
    description:
      'Lift every person in the attached photo into the scene as separate clay figures (SAM 3.1 masks, then one SAM 3D Body GLB per person). A group photo becomes Person 1, Person 2, … — pose_object each id on its own. Import sits them on the floor side by side. Do not invent extra XYZ.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'generate_prop',
    description:
      'Lift a single prop from the attached photo into the scene as a GLB. prompt is the object noun, e.g. helmet. Import sits it on the floor — do not invent XYZ.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Object noun, e.g. helmet' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'create_object_path',
    description: 'Create a new motion path for objects (not the camera). Returns the path id for set_follow_path.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        anchors: { type: 'array', items: vec3, minItems: 2 },
        closed: { type: 'boolean' },
      },
      required: ['anchors'],
    },
  },
  {
    name: 'set_object_path',
    description: 'Replace anchors on an existing object path (never the camera path).',
    input_schema: {
      type: 'object',
      properties: {
        path_id: { type: 'string' },
        anchors: { type: 'array', items: vec3, minItems: 2 },
        closed: { type: 'boolean' },
      },
      required: ['path_id', 'anchors'],
    },
  },
  {
    name: 'update_pose_keyframe',
    description: "Move an object's pose key in time (0..1).",
    input_schema: {
      type: 'object',
      properties: {
        object_id: { type: 'string' },
        key_id: { type: 'string' },
        time: { type: 'number' },
      },
      required: ['object_id', 'key_id', 'time'],
    },
  },
  {
    name: 'remove_pose_keyframe',
    description: 'Delete one pose key from an object.',
    input_schema: {
      type: 'object',
      properties: {
        object_id: { type: 'string' },
        key_id: { type: 'string' },
      },
      required: ['object_id', 'key_id'],
    },
  },
  {
    name: 'set_object_clips',
    description: 'Play or pause embedded GLB animation clips on an object.',
    input_schema: {
      type: 'object',
      properties: {
        object_id: { type: 'string' },
        play: { type: 'boolean' },
      },
      required: ['object_id', 'play'],
    },
  },
]

type Executor = (input: Record<string, unknown>) => string | Promise<string>

const asVec3 = (v: unknown): Vec3 => {
  const a = v as number[]
  return [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0]
}

const commitActiveCamera = (result: string) => {
  useCameraOptionsStore.getState().captureActive()
  return result
}

function resolveSubjectBox(subjectId: string) {
  if (subjectId) {
    const box = subjectAabb(subjectId)
    if (box) return { id: subjectId, box }
  }
  const selected = selectedObjectId()
  if (selected) {
    const box = subjectAabb(selected)
    if (box) return { id: selected, box }
  }
  const ranked = objectCandidates()
    .filter((o) => !o.isFloorish)
    .sort((a, b) => b.area - a.area)
  const top = ranked[0]
  if (!top) return null
  const box = subjectAabb(top.id)
  return box ? { id: top.id, box } : null
}

function runInstantiateAtom(input: Record<string, unknown>, requireSubject: boolean): string {
  const kind = parseAtomKind(input.kind)
  if (!kind) return `Unknown atom kind "${String(input.kind)}".`
  const subjectId = typeof input.subject_id === 'string' ? input.subject_id.trim() : ''
  const resolved = resolveSubjectBox(subjectId)
  if (!resolved) {
    if (requireSubject) return 'instantiate_atom needs a subject_id from scene_state.'
    applyCameraPreset(kind)
    return commitActiveCamera(`Applied "${kind}" preset from the scene bounds (no subject).`)
  }
  const atom = atomFromSubject({
    kind,
    subject: resolved.box,
    scale: parseScaleInput(input.scale),
    angle: parseAngleInput(input.angle),
  })
  const duration = typeof input.duration === 'number' ? input.duration : undefined
  applyAtomPath(atom, duration)
  return commitActiveCamera(`${formatAtomResult(atom)} subject=${resolved.id}`)
}

const EXECUTORS: Record<string, Executor> = {
  load_skill: (input) => {
    const name = String(input.name)
    const builtIn = getSkill(name)
    if (builtIn) return builtIn.body
    // fall back to a user-authored project skill (case-insensitive name match)
    const custom = useProjectStore
      .getState()
      .skills.find((s) => s.name.toLowerCase() === name.toLowerCase())
    if (custom) return custom.body || `(The "${custom.name}" skill has no instructions yet.)`
    const names = [
      ...AGENT_SKILLS.map((s) => s.name),
      ...useProjectStore.getState().skills.map((s) => s.name),
    ]
    return `Unknown skill "${name}". Available: ${names.join(', ')}.`
  },

  begin_camera_option: (input) => {
    const name = String(input.name ?? '').trim()
    if (name.length < 3 || /^camera(?:\s+\d+)?$/i.test(name)) {
      return 'Choose a descriptive camera name such as "Low Chase", "Hero Orbit", or "Top Flyover".'
    }
    const option = beginGeneratedCameraOption(name)
    useEditorStore.getState().select('cinema-camera')
    return `Started camera option "${option.name}" (id ${option.id}). Build its path, timing, look-at, and lens now.`
  },

  switch_camera_option: (input) => {
    const cameras = useCameraOptionsStore.getState()
    const id = String(input.camera_id)
    const option = cameras.options.find((candidate) => candidate.id === id)
    if (!option) return `No camera option with id "${id}".`
    cameras.switchOption(id)
    useEditorStore.getState().select('cinema-camera')
    return `Selected camera option "${option.name}".`
  },

  measure_subject: (input) => {
    const id = String(input.object_id ?? '')
    const box = subjectAabb(id)
    const object = useSceneStore.getState().objects.find((item) => item.id === id)
    if (!box || !object) return `No object with id "${id}".`
    return JSON.stringify({
      id,
      name: object.name,
      center: box.center.map((n) => +n.toFixed(3)),
      size: box.size.map((n) => +n.toFixed(3)),
      diagonal: +box.diagonal.toFixed(3),
    })
  },

  instantiate_atom: (input) => runInstantiateAtom(input, true),

  apply_camera_preset: (input) => runInstantiateAtom(input, false),

  set_camera_path: (input) => {
    if (input.custom !== true) {
      return 'set_camera_path is only for move_kind=custom. Call instantiate_atom for orbit/arc/dolly/crane/pan/tilt/zoom/flyover.'
    }
    const anchors = (input.anchors as unknown[]).map(asVec3)
    mutateFollowedPath(() => {
      usePathStore.getState().setPath(anchors, Boolean(input.closed))
    })
    return commitActiveCamera(`Camera path set: ${anchors.length} anchors, closed=${Boolean(input.closed)}.`)
  },

  set_path_params: (input) => {
    const rig = useRigStore.getState()
    const changed: string[] = []
    mutateFollowedPath(() => {
      const path = usePathStore.getState()
      if (typeof input.rounding === 'number') (path.setRounding(input.rounding), changed.push(`rounding=${input.rounding}`))
      if (typeof input.height === 'number') (path.setPathHeight(input.height), changed.push(`height=${input.height}`))
    })
    if (typeof input.duration === 'number') (rig.setDuration(input.duration), changed.push(`duration=${input.duration}s`))
    if (typeof input.smoothness === 'number') (rig.setSmoothness(input.smoothness), changed.push(`smoothness=${input.smoothness}`))
    if (typeof input.loop === 'boolean') (rig.setLoop(input.loop), changed.push(`loop=${input.loop}`))
    return commitActiveCamera(changed.length ? `Updated ${changed.join(', ')}.` : 'Nothing to change.')
  },

  set_camera_keyframes: (input) => {
    const rig = useRigStore.getState()
    rig.clearProgressKeys()
    const keys = input.keys as { time: number; progress: number }[]
    keys.forEach((k) => rig.upsertProgressKey(k.time, k.progress))
    return commitActiveCamera(`Set ${keys.length} camera keyframes.`)
  },

  set_look_at: (input) => {
    const rig = useRigStore.getState()
    const scene = { objects: useSceneStore.getState().objects, paths: usePathStore.getState().paths }
    const hasOffset = Array.isArray(input.offset) && input.offset.length >= 3
    const objectId = typeof input.object_id === 'string' ? input.object_id.trim() : ''
    if (hasOffset && !objectId && !rig.targetObjectId) {
      return 'offset needs a tracked object. Pass object_id, or track an object first.'
    }
    if (input.mode === 'motion') {
      rig.setLookAtMode('path-tangent')
    } else {
      rig.setLookAtMode('target')
    }
    if (objectId) {
      const object = scene.objects.find((item) => item.id === objectId)
      if (!object) return `No object with id "${objectId}".`
      if (input.mode !== 'motion') rig.clearChannel('target')
      setTrackObjectId(object.id, scene)
    } else if (input.object_id === '' || (input.mode === 'target' && input.target && input.path_space !== 'object')) {
      setTrackObjectId(null, scene)
    }
    if (input.mode === 'target' && input.target) {
      useRigStore.getState().setTarget(asVec3(input.target))
    }
    if (hasOffset) {
      const offset = asVec3(input.offset)
      const live = useRigStore.getState()
      if (live.lookOffsetKeys.length > 0) live.upsertLookOffsetKey(live.t, offset)
      else live.setLookOffset(offset)
    }
    if (input.path_space === 'object') {
      const parentId = objectId || useRigStore.getState().targetObjectId
      if (!parentId) return 'path_space=object needs object_id (or an existing tracked object).'
      setCameraPathSpace('object', scene)
    } else if (input.path_space === 'world') {
      setCameraPathSpace('world', scene)
    }
    const next = useRigStore.getState()
    const tracked = next.targetObjectId
      ? scene.objects.find((item) => item.id === next.targetObjectId)?.name
      : null
    const bits = [
      next.lookAtMode === 'path-tangent' ? 'motion' : tracked ? `tracking "${tracked}"` : 'target',
      next.pathSpace === 'object' ? 'path rides object' : 'path in world',
    ]
    if (tracked && next.lookAtMode === 'target') {
      bits.push(
        `offset [${next.lookOffset.map((n) => n.toFixed(2)).join(', ')}]`,
      )
    }
    return commitActiveCamera(`Look-at: ${bits.join(', ')}.`)
  },

  set_camera_noise: (input) => {
    const rig = useRigStore.getState()
    const patch: Parameters<typeof rig.setCameraNoise>[0] = {}
    if (typeof input.enabled === 'boolean') patch.enabled = input.enabled
    if (input.style === 'shake' || input.style === 'handheld' || input.style === 'rumble') {
      patch.style = input.style
    }
    if (typeof input.intensity === 'number') patch.intensity = Math.min(1, Math.max(0, input.intensity))
    if (typeof input.start === 'number') patch.start = Math.min(1, Math.max(0, input.start))
    if (typeof input.end === 'number') patch.end = Math.min(1, Math.max(0, input.end))
    if (typeof input.fade_in === 'number') patch.fadeIn = Math.min(8, Math.max(0, input.fade_in))
    if (typeof input.fade_out === 'number') patch.fadeOut = Math.min(8, Math.max(0, input.fade_out))
    if (typeof input.amp_pos === 'number') patch.ampPos = Math.min(0.2, Math.max(0, input.amp_pos))
    if (typeof input.amp_rot === 'number') patch.ampRot = Math.min(8, Math.max(0, input.amp_rot))
    if (typeof input.freq === 'number') patch.freq = Math.min(12, Math.max(0.5, input.freq))
    if (typeof input.seed === 'number') patch.seed = input.seed
    if (Object.keys(patch).length === 0) return 'Nothing to change on camera noise.'
    if (patch.start !== undefined && patch.end !== undefined && patch.start > patch.end) {
      const swap = patch.start
      patch.start = patch.end
      patch.end = swap
    }
    rig.setCameraNoise(patch)
    const n = useRigStore.getState().cameraNoise
    const startS = (n.start * rig.duration).toFixed(1)
    const endS = (n.end * rig.duration).toFixed(1)
    return commitActiveCamera(
      `Camera noise ${n.enabled ? 'on' : 'off'} ${n.style} ×${n.intensity.toFixed(2)} ${startS}s–${endS}s fade ${n.fadeIn.toFixed(1)}/${n.fadeOut.toFixed(1)}s.`,
    )
  },

  set_follow_path: (input) => {
    const scene = useSceneStore.getState()
    const object = scene.objects.find((o) => o.id === input.object_id)
    if (!object) return `No object with id "${input.object_id}".`
    const pathId = typeof input.path_id === 'string' ? input.path_id.trim() : ''
    if (!pathId) {
      scene.setFollow(object.id, null)
      return `Detached "${object.name}" from its path.`
    }
    const path = usePathStore.getState().paths.find((p) => p.id === pathId)
    if (!path) return `No path with id "${pathId}".`
    const current = object.follow ?? defaultFollow(pathId)
    scene.setFollow(object.id, {
      ...current,
      pathId,
      align: typeof input.align === 'boolean' ? input.align : current.align,
      offset: typeof input.offset === 'number' ? input.offset : current.offset,
      height: typeof input.height === 'number' ? input.height : current.height,
      bank: typeof input.bank === 'number' ? input.bank : current.bank,
      loops: typeof input.loops === 'number' ? input.loops : current.loops,
    })
    return `"${object.name}" follows "${path.name}".`
  },

  set_lens: (input) => {
    const rig = useRigStore.getState()
    const changed: string[] = []
    if (typeof input.fov === 'number') (rig.setFov(input.fov), changed.push(`fov=${input.fov}`))
    if (typeof input.roll === 'number') (rig.setRoll(input.roll), changed.push(`roll=${input.roll}`))
    return commitActiveCamera(changed.length ? `Lens: ${changed.join(', ')}.` : 'Nothing to change.')
  },

  pose_object: (input) => {
    const scene = useSceneStore.getState()
    const object = scene.objects.find((o) => o.id === input.object_id)
    if (!object) return `No object with id "${input.object_id}".`
    const lift = input.lift === true
    const position = input.position
      ? lift
        ? asVec3(input.position)
        : ([asVec3(input.position)[0], object.transform.position[1], asVec3(input.position)[2]] as Vec3)
      : object.transform.position
    scene.setTransformAll(object.id, {
      position,
      rotation: input.rotation ? asVec3(input.rotation) : object.transform.rotation,
      scale: input.scale ? asVec3(input.scale) : object.transform.scale,
    })
    if (lift) return `Posed "${object.name}" (lifted).`
    const note = snapObjectToFloor(object.id)
    return `Posed "${object.name}"${note ? ` ${note}` : ''}.`
  },

  add_pose_keyframe: (input) => {
    const scene = useSceneStore.getState()
    const object = scene.objects.find((o) => o.id === input.object_id)
    if (!object) return `No object with id "${input.object_id}".`
    scene.addObjectKey(object.id, Math.min(1, Math.max(0, Number(input.time) || 0)))
    return `Keyframed "${object.name}" at t=${input.time}.`
  },

  apply_spin: (input) => {
    const scene = useSceneStore.getState()
    const object = scene.objects.find((o) => o.id === input.object_id)
    if (!object) return `No object with id "${input.object_id}".`
    scene.applySpinPreset(object.id)
    return `"${object.name}" now spins 360 over the timeline.`
  },

  clear_object_animation: (input) => {
    const scene = useSceneStore.getState()
    const object = scene.objects.find((o) => o.id === input.object_id)
    if (!object) return `No object with id "${input.object_id}".`
    scene.clearObjectKeys(object.id)
    return `Cleared animation on "${object.name}".`
  },

  set_playhead: (input) => {
    const rig = useRigStore.getState()
    rig.setPlaying(false)
    rig.setT(Math.min(1, Math.max(0, Number(input.t) || 0)))
    return `Playhead at ${(rig.t * rig.duration).toFixed(1)}s.`
  },

  play_preview: () => {
    const rig = useRigStore.getState()
    if (!cameraReady()) return 'No camera path yet — create one first.'
    rig.setT(0)
    applyBeginPlayback()
    return 'Playing.'
  },

  set_output_format: (input) => {
    const editor = useEditorStore.getState()
    const changed: string[] = []
    if (typeof input.aspect === 'string') {
      editor.setExportAspect(input.aspect as ExportAspect)
      changed.push(input.aspect as string)
    }
    if (input.resolution === '720' || input.resolution === '1080') {
      editor.setExportRes(Number(input.resolution) as ExportRes)
      changed.push(`${input.resolution}p`)
    }
    return changed.length ? `Output format: ${changed.join(' · ')}.` : 'Nothing to change.'
  },

  save_shot: () => {
    if (!cameraReady()) return 'No camera path to save yet.'
    void saveCurrentAsShot()
    return 'Saved this move as a shot on the Board.'
  },

  add_primitive: (input) => {
    const role = asPrimitiveRole(input.role)
    const kind = role === 'floor' ? 'plane' : asPrimitiveKind(input.kind)
    if (!kind) return 'add_primitive needs kind: box, sphere, cylinder, cone, plane, or torus.'
    const scene = useSceneStore.getState()
    scene.addPrimitive(kind)
    const object = useSceneStore.getState().objects.at(-1)
    if (!object) return `Added a ${kind}.`
    const size = Array.isArray(input.size) ? asVec3(input.size) : undefined
    const position = input.position ? asVec3(input.position) : undefined
    return configurePlacedPrimitive({
      id: object.id,
      kind,
      role,
      size,
      position,
      lift: input.lift === true,
    })
  },

  block_people_from_image: () => {
    const { falKey, samImageVersion } = readFalSettings()
    const scene = useSceneStore.getState()
    return liftAttachedStill({
      kind: 'person',
      prompt: 'person',
      falKey,
      version: samImageVersion,
      importBuffer: importModelBuffer,
      beginLift: scene.beginLift,
      endLift: scene.endLift,
      replacePrevious: (objectId) => scene.removeObject(objectId),
      placeObject: (objectId, position) => {
        const live = useSceneStore.getState()
        const object = live.objects.find((item) => item.id === objectId)
        if (!object) return
        live.setTransformAll(objectId, { ...object.transform, position })
      },
    })
  },

  generate_prop: (input) => {
    const { falKey, samImageVersion } = readFalSettings()
    const scene = useSceneStore.getState()
    return liftAttachedStill({
      kind: 'prop',
      prompt: String(input.prompt ?? ''),
      falKey,
      version: samImageVersion,
      importBuffer: importModelBuffer,
      beginLift: scene.beginLift,
      endLift: scene.endLift,
      replacePrevious: (objectId) => scene.removeObject(objectId),
    })
  },

  create_object_path: (input) => {
    const anchors = (input.anchors as unknown[]).map(asVec3)
    const path = usePathStore.getState()
    const prev = path.activePathId
    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : undefined
    const id = path.createPath(name)
    path.setPath(anchors, Boolean(input.closed))
    usePathStore.getState().setActivePath(prev)
    const created = usePathStore.getState().getPath(id)
    return `Created object path "${created?.name ?? id}" (id ${id}) with ${anchors.length} anchors.`
  },

  set_object_path: (input) => {
    const pathId = String(input.path_id)
    if (pathId === CAMERA_PATH_ID || pathId === followedPathId()) {
      return 'Use instantiate_atom or set_camera_path for the camera path.'
    }
    const path = usePathStore.getState()
    const existing = path.getPath(pathId)
    if (!existing) return `No path with id "${pathId}".`
    const prev = path.activePathId
    path.setActivePath(pathId)
    path.setPath((input.anchors as unknown[]).map(asVec3), Boolean(input.closed))
    usePathStore.getState().setActivePath(prev)
    return `Updated path "${existing.name}".`
  },

  update_pose_keyframe: (input) => {
    const scene = useSceneStore.getState()
    const object = scene.objects.find((o) => o.id === input.object_id)
    if (!object) return `No object with id "${input.object_id}".`
    const keyId = String(input.key_id)
    if (!object.keys.some((k) => k.id === keyId)) return `No key "${keyId}" on "${object.name}".`
    scene.updateObjectKeyTime(object.id, keyId, Number(input.time) || 0)
    return `Moved key ${keyId} on "${object.name}".`
  },

  remove_pose_keyframe: (input) => {
    const scene = useSceneStore.getState()
    const object = scene.objects.find((o) => o.id === input.object_id)
    if (!object) return `No object with id "${input.object_id}".`
    scene.removeObjectKey(object.id, String(input.key_id))
    return `Removed key ${input.key_id} from "${object.name}".`
  },

  set_object_clips: (input) => {
    const scene = useSceneStore.getState()
    const object = scene.objects.find((o) => o.id === input.object_id)
    if (!object) return `No object with id "${input.object_id}".`
    if (object.clips.length === 0) return `"${object.name}" has no embedded clips.`
    scene.setPlayClips(object.id, Boolean(input.play))
    return `${Boolean(input.play) ? 'Playing' : 'Paused'} clips on "${object.name}".`
  },
}

const PLACE_TOOLS = new Set([
  'add_primitive',
  'pose_object',
  'generate_prop',
  'block_people_from_image',
])

export async function executeTool(name: string, input: unknown): Promise<string> {
  const executor = EXECUTORS[name]
  if (!executor) return `Unknown tool "${name}".`
  const result = await executor((input ?? {}) as Record<string, unknown>)
  const lift = Boolean((input as Record<string, unknown> | null)?.lift)
  if (!PLACE_TOOLS.has(name) || lift) return result
  const audit = snapSceneToFloor()
  return audit ? `${result}\n${audit}` : result
}

/** Compact scene/rig state the agent receives with every user message. */
export function buildSceneContext(): string {
  const scene = useSceneStore.getState()
  const rig = useRigStore.getState()
  const camPath = cameraPath()
  const editor = useEditorStore.getState()
  const cameraOptions = getCameraOptionsSnapshot()
  const activeCameraOptionId = useCameraOptionsStore.getState().activeOptionId

  const box = new THREE.Box3()
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()

  const objects = scene.objects.map((o) => {
    const group = objectGroups.get(o.id)
    let bounds = null
    if (group) {
      group.updateWorldMatrix(true, true)
      box.setFromObject(group)
      box.getSize(size)
      box.getCenter(center)
      bounds = {
        size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)],
        center: [+center.x.toFixed(2), +center.y.toFixed(2), +center.z.toFixed(2)],
      }
    }
    return {
      id: o.id,
      name: o.name,
      bounds,
      transform: o.transform,
      pose_keyframes: o.keys.length,
      follow: o.follow ?? null,
      embedded_clips: o.clips.length,
    }
  })

  const attach = getLiftAttachment()

  return JSON.stringify(
    {
      objects,
      camera_options: cameraOptions.map((option) => ({
        id: option.id,
        name: option.name,
        active: option.id === activeCameraOptionId,
        anchors: option.rig.anchors.length,
        duration_s: option.rig.duration,
      })),
      camera_rig: {
        anchors: (camPath?.anchors ?? []).map((a) => a.position.map((n) => +n.toFixed(2))),
        closed: camPath?.closed ?? false,
        duration_s: rig.duration,
        default_curve: rig.ease,
        rounding: camPath?.rounding ?? 0.8,
        loop: rig.loop,
        camera_keyframes: rig.progressKeys.map((k) => ({ time: +k.time.toFixed(2), progress: +k.progress.toFixed(2) })),
        look_at:
          rig.lookAtMode === 'target'
            ? rig.targetObjectId
              ? {
                  mode: 'target',
                  track_object_id: rig.targetObjectId,
                  offset: rig.lookOffset.map((n) => +n.toFixed(2)),
                }
              : { mode: 'target', target: rig.target }
            : { mode: 'motion' },
        path_space: rig.pathSpace,
        path_parent_id: rig.pathSpace === 'object' ? rig.targetObjectId : null,
        fov: rig.fov,
        roll: rig.roll,
        noise: rig.cameraNoise,
      },
      paths: usePathStore.getState().paths.map((p) => ({ id: p.id, name: p.name, anchors: p.anchors.length })),
      output_format: { aspect: editor.exportAspect, resolution: editor.exportRes },
      playhead_t: +rig.t.toFixed(2),
      attached_photo: attach ? attach.name : null,
    },
    null,
    1,
  )
}

/** JPEG screenshot of the viewport, downscaled — base64 without the data: prefix. */
export function captureViewport(maxWidth = 768): string | null {
  const canvas = document.querySelector('canvas')
  if (!canvas) return null
  // force a fresh render so the WebGL buffer isn't blank (no preserveDrawingBuffer)
  renderBridge.advance?.(performance.now())
  const scale = Math.min(1, maxWidth / canvas.width)
  const copy = document.createElement('canvas')
  copy.width = Math.max(2, Math.round(canvas.width * scale))
  copy.height = Math.max(2, Math.round(canvas.height * scale))
  copy.getContext('2d')!.drawImage(canvas, 0, 0, copy.width, copy.height)
  return copy.toDataURL('image/jpeg', 0.7).split(',')[1] ?? null
}
