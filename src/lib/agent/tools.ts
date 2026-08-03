import * as THREE from 'three'
import type { ToolDef } from './providers'
import { getSkill } from './skills'
import { useRigStore } from '../../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore } from '../../state/usePathStore'
import { useSceneStore, type Vec3 } from '../../state/useSceneStore'
import { useEditorStore } from '../../state/useEditorStore'
import { useProjectStore } from '../../state/useProjectStore'
import { applyCameraPreset, type PresetKind } from '../presets'
import { saveCurrentAsShot } from '../projects'
import { objectGroups } from '../../viewport/SceneObjects'
import { renderBridge } from '../renderBridge'
import type { ExportAspect, ExportRes } from '../../state/useEditorStore'
import type { PrimitiveKind } from '../primitiveGeometry'
import {
  beginGeneratedCameraOption,
  getCameraOptionsSnapshot,
  useCameraOptionsStore,
} from '../../state/useCameraOptionsStore'

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
    name: 'apply_camera_preset',
    description: 'Replace the camera path with a preset generated around the scene bounding box.',
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['orbit', 'arc', 'flyover', 'dolly'] } },
      required: ['kind'],
    },
  },
  {
    name: 'set_camera_path',
    description:
      'Replace the camera path with explicit anchor positions (world units, Y up, floor at y=0). Curves between anchors are auto-smoothed by the rounding parameter.',
    input_schema: {
      type: 'object',
      properties: {
        anchors: { type: 'array', items: vec3, minItems: 2, description: 'Anchor positions [x,y,z]' },
        closed: { type: 'boolean', description: 'Close the path into a loop' },
      },
      required: ['anchors', 'closed'],
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
    description: 'Where the camera looks: a fixed world-space target or the direction of motion.',
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['target', 'motion'] },
        target: { ...vec3, description: 'World position (only for mode=target)' },
      },
      required: ['mode'],
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
    description: 'Set the current pose of a scene object. Only include the parts you want to change.',
    input_schema: {
      type: 'object',
      properties: {
        object_id: { type: 'string' },
        position: vec3,
        rotation: { ...vec3, description: 'Euler XYZ in degrees' },
        scale: vec3,
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
      'Add a basic clay shape to the scene (to build a set: pedestals, backdrops, blocking). Optionally place it.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus'] },
        position: { ...vec3, description: 'World position [x,y,z] (optional)' },
      },
      required: ['kind'],
    },
  },
]

type Executor = (input: Record<string, unknown>) => string

const asVec3 = (v: unknown): Vec3 => {
  const a = v as number[]
  return [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0]
}

const commitActiveCamera = (result: string) => {
  useCameraOptionsStore.getState().captureActive()
  return result
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
      ...['drone', 'packshot', 'orbit-reveal', 'dolly-push'],
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

  apply_camera_preset: (input) => {
    applyCameraPreset(input.kind as PresetKind)
    const rig = useRigStore.getState()
    const cam = usePathStore.getState().getPath(CAMERA_PATH_ID)
    return commitActiveCamera(
      `Applied "${input.kind}" preset: ${cam?.anchors.length ?? 0} anchors, closed=${cam?.closed ?? false}, target=${rig.target.map((n) => n.toFixed(1)).join(',')}.`,
    )
  },

  set_camera_path: (input) => {
    const anchors = (input.anchors as unknown[]).map(asVec3)
    const path = usePathStore.getState()
    // edit the camera path without stealing the user's active-path focus
    const prevActive = path.activePathId
    path.setActivePath(CAMERA_PATH_ID)
    path.setPath(anchors, Boolean(input.closed))
    usePathStore.getState().setActivePath(prevActive)
    return commitActiveCamera(`Camera path set: ${anchors.length} anchors, closed=${Boolean(input.closed)}.`)
  },

  set_path_params: (input) => {
    const rig = useRigStore.getState()
    const path = usePathStore.getState()
    const prevActive = path.activePathId
    path.setActivePath(CAMERA_PATH_ID)
    const changed: string[] = []
    if (typeof input.rounding === 'number') (path.setRounding(input.rounding), changed.push(`rounding=${input.rounding}`))
    if (typeof input.height === 'number') (path.setPathHeight(input.height), changed.push(`height=${input.height}`))
    if (typeof input.duration === 'number') (rig.setDuration(input.duration), changed.push(`duration=${input.duration}s`))
    if (typeof input.smoothness === 'number') (rig.setSmoothness(input.smoothness), changed.push(`smoothness=${input.smoothness}`))
    if (typeof input.loop === 'boolean') (rig.setLoop(input.loop), changed.push(`loop=${input.loop}`))
    usePathStore.getState().setActivePath(prevActive)
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
    rig.setLookAtMode(input.mode === 'motion' ? 'path-tangent' : 'target')
    if (input.mode === 'target' && input.target) rig.setTarget(asVec3(input.target))
    return commitActiveCamera(
      `Look-at: ${input.mode}${input.target ? ` @ ${asVec3(input.target).join(',')}` : ''}.`,
    )
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
    scene.setTransformAll(object.id, {
      position: input.position ? asVec3(input.position) : object.transform.position,
      rotation: input.rotation ? asVec3(input.rotation) : object.transform.rotation,
      scale: input.scale ? asVec3(input.scale) : object.transform.scale,
    })
    return `Posed "${object.name}".`
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
    if ((usePathStore.getState().getPath(CAMERA_PATH_ID)?.anchors.length ?? 0) < 2)
      return 'No camera path yet — create one first.'
    rig.setT(0)
    rig.setPlaying(true)
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
    if ((usePathStore.getState().getPath(CAMERA_PATH_ID)?.anchors.length ?? 0) < 2)
      return 'No camera path to save yet.'
    void saveCurrentAsShot()
    return 'Saved this move as a shot on the Board.'
  },

  add_primitive: (input) => {
    const kind = input.kind as PrimitiveKind
    const scene = useSceneStore.getState()
    scene.addPrimitive(kind)
    const object = useSceneStore.getState().objects.at(-1)
    if (object && input.position) {
      scene.setTransformAll(object.id, { ...object.transform, position: asVec3(input.position) })
    }
    return `Added a ${kind}${input.position ? ` at ${asVec3(input.position).join(',')}` : ''} (id ${object?.id}).`
  },
}

export function executeTool(name: string, input: unknown): string {
  const executor = EXECUTORS[name]
  if (!executor) return `Unknown tool "${name}".`
  return executor((input ?? {}) as Record<string, unknown>)
}

/** Compact scene/rig state the agent receives with every user message. */
export function buildSceneContext(): string {
  const scene = useSceneStore.getState()
  const rig = useRigStore.getState()
  const camPath = usePathStore.getState().getPath(CAMERA_PATH_ID)
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
      embedded_clips: o.clips.length,
    }
  })

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
        look_at: rig.lookAtMode === 'target' ? { mode: 'target', target: rig.target } : { mode: 'motion' },
        fov: rig.fov,
        roll: rig.roll,
      },
      output_format: { aspect: editor.exportAspect, resolution: editor.exportRes },
      playhead_t: +rig.t.toFixed(2),
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
