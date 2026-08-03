import * as THREE from 'three'
import { beginGeneratedCameraOption, useCameraOptionsStore } from '../../state/useCameraOptionsStore'
import { useRigStore } from '../../state/useRigStore'
import { CAMERA_PATH_ID, usePathStore } from '../../state/usePathStore'
import { useEditorStore } from '../../state/useEditorStore'
import type { Vec3 } from '../../state/useSceneStore'
import { useSceneStore } from '../../state/useSceneStore'
import { sceneBounds } from '../../viewport/SceneObjects'

export interface RacingDroneCameraSpec {
  name: string
  anchors: Vec3[]
  closed: boolean
  lookAt: 'target' | 'path-tangent'
  /** World-space look-at when mode is target. */
  target: Vec3
  fov: number
  roll: number
  smoothness: number
  rounding: number
  progressKeys?: { time: number; progress: number }[]
}

interface YachtFrame {
  center: THREE.Vector3
  halfLen: number
  deckY: number
  seaY: number
  /** radians — direction from center toward bow */
  bowAngle: number
  bow: Vec3
  stern: Vec3
  deck: Vec3
}

function defaultBox() {
  return new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1))
}

/** Derive bow axis, deck height, and focal points from the live scene bbox. */
export function yachtFrame(): YachtFrame {
  const box = sceneBounds() ?? defaultBox()
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const halfLen = Math.max(size.x, size.z, 0.5) / 2
  const deckY = box.min.y + size.y * 0.58
  const seaY = box.min.y + Math.max(0.08, size.y * 0.06)
  const bowAngle = size.z >= size.x ? Math.PI / 2 : 0

  const bow: Vec3 = [
    center.x + Math.cos(bowAngle) * halfLen * 0.82,
    deckY,
    center.z + Math.sin(bowAngle) * halfLen * 0.82,
  ]
  const stern: Vec3 = [
    center.x - Math.cos(bowAngle) * halfLen * 0.78,
    deckY,
    center.z - Math.sin(bowAngle) * halfLen * 0.78,
  ]
  const deck: Vec3 = [center.x, deckY, center.z]

  return { center, halfLen, deckY, seaY, bowAngle, bow, stern, deck }
}

/** Camera position relative to yacht: relAngle 0 = bow, π = stern, ±π/2 = sides. */
function camPos(frame: YachtFrame, relAngle: number, dist: number, y: number): Vec3 {
  const angle = frame.bowAngle + relAngle
  const d = Math.max(dist, frame.halfLen * 1.22)
  return [
    frame.center.x + Math.cos(angle) * d,
    y,
    frame.center.z + Math.sin(angle) * d,
  ]
}

/** Overhead position — keeps horizontal offset small so the hull fills frame. */
function overheadPos(frame: YachtFrame, relAngle: number, dist: number, lift: number): Vec3 {
  const angle = frame.bowAngle + relAngle
  const d = Math.max(dist, frame.halfLen * 1.05)
  return [
    frame.center.x + Math.cos(angle) * d,
    frame.deckY + lift,
    frame.center.z + Math.sin(angle) * d,
  ]
}

/**
 * 10 high-speed racing-drone recipes aligned to Seedance yacht performance language.
 * All paths keep the hull in frame via look-at targets on deck / bow / stern.
 */
export function buildRacingDroneCameraSpecs(_durationSeconds = 10): RacingDroneCameraSpec[] {
  const f = yachtFrame()
  const hl = f.halfLen
  const sea = f.seaY
  const low = f.deckY * 0.72
  const mid = f.deckY
  const high = f.deckY + hl * 1.15
  const top = f.deckY + hl * 2.8

  return [
    {
      name: 'RD 2.4 Front Sea POV',
      // Sea-level chase into the bow — Seedance 2.4
      anchors: [
        camPos(f, 0, hl * 3.1, sea),
        camPos(f, 0, hl * 2.1, sea + 0.04),
        camPos(f, 0, hl * 1.45, sea + 0.06),
        camPos(f, -0.08, hl * 1.28, low),
      ],
      closed: false,
      lookAt: 'target',
      target: f.bow,
      fov: 68,
      roll: -4,
      smoothness: 0.22,
      rounding: 0.9,
      progressKeys: [
        { time: 0.4, progress: 0.58 },
        { time: 1, progress: 1 },
      ],
    },
    {
      name: 'RD 2.8 Side Sea Whip',
      // Beam pass at waterline — Seedance 2.8
      anchors: [
        camPos(f, Math.PI * 0.55, hl * 2.6, sea),
        camPos(f, Math.PI * 0.5, hl * 1.55, sea + 0.05),
        camPos(f, Math.PI * 0.45, hl * 1.45, low),
        camPos(f, Math.PI * 0.35, hl * 2.2, mid),
      ],
      closed: false,
      lookAt: 'target',
      target: f.deck,
      fov: 72,
      roll: 8,
      smoothness: 0.14,
      rounding: 0.88,
      progressKeys: [
        { time: 0.42, progress: 0.68 },
        { time: 1, progress: 1 },
      ],
    },
    {
      name: 'RD 2.17 Rear Chase High',
      // High rear chase — Seedance 2.17
      anchors: [
        camPos(f, Math.PI, hl * 3.0, high),
        camPos(f, Math.PI, hl * 2.2, mid + hl * 0.35),
        camPos(f, Math.PI * 0.92, hl * 1.65, mid),
        camPos(f, Math.PI * 0.88, hl * 1.45, mid + hl * 0.15),
      ],
      closed: false,
      lookAt: 'target',
      target: f.stern,
      fov: 65,
      roll: 3,
      smoothness: 0.2,
      rounding: 0.92,
      progressKeys: [
        { time: 0.45, progress: 0.62 },
        { time: 1, progress: 1 },
      ],
    },
    {
      name: 'RD 1.1 Overhead Cruising',
      // Wide overhead straight cruise — Seedance 1.1
      anchors: [
        overheadPos(f, -0.15, hl * 1.35, hl * 2.6),
        overheadPos(f, 0, hl * 1.15, hl * 2.75),
        overheadPos(f, 0.12, hl * 1.25, hl * 2.65),
        overheadPos(f, 0.28, hl * 1.5, hl * 2.5),
      ],
      closed: false,
      lookAt: 'target',
      target: f.deck,
      fov: 58,
      roll: 0,
      smoothness: 0.25,
      rounding: 0.94,
      progressKeys: [
        { time: 0.5, progress: 0.7 },
        { time: 1, progress: 1 },
      ],
    },
    {
      name: 'RD 1.2 Overhead Turn Arc',
      // Overhead turn sweep — Seedance 1.2
      anchors: [
        overheadPos(f, Math.PI * 0.35, hl * 1.8, hl * 2.9),
        overheadPos(f, Math.PI * 0.2, hl * 1.4, hl * 2.7),
        overheadPos(f, 0, hl * 1.2, hl * 2.65),
        overheadPos(f, -Math.PI * 0.22, hl * 1.55, hl * 2.55),
      ],
      closed: false,
      lookAt: 'target',
      target: f.deck,
      fov: 60,
      roll: -5,
      smoothness: 0.18,
      rounding: 0.96,
      progressKeys: [
        { time: 0.48, progress: 0.65 },
        { time: 1, progress: 1 },
      ],
    },
    {
      name: 'RD 2.1 Front High Dive',
      // High front push-in — Seedance 2.1
      anchors: [
        camPos(f, 0.05, hl * 2.8, top),
        camPos(f, 0.03, hl * 2.0, high),
        camPos(f, 0, hl * 1.55, mid + hl * 0.25),
        camPos(f, -0.06, hl * 1.32, mid),
      ],
      closed: false,
      lookAt: 'target',
      target: f.bow,
      fov: 62,
      roll: -6,
      smoothness: 0.28,
      rounding: 0.9,
      progressKeys: [
        { time: 0.55, progress: 0.48 },
        { time: 1, progress: 1 },
      ],
    },
    {
      name: 'RD 2.10 3/4 Front Pass',
      // Medium 3/4 front hero pass — Seedance 2.10
      anchors: [
        camPos(f, -Math.PI * 0.28, hl * 2.5, mid + hl * 0.2),
        camPos(f, -Math.PI * 0.22, hl * 1.75, mid),
        camPos(f, -Math.PI * 0.18, hl * 1.42, mid),
        camPos(f, -Math.PI * 0.12, hl * 2.0, high * 0.95),
      ],
      closed: false,
      lookAt: 'target',
      target: f.bow,
      fov: 64,
      roll: -7,
      smoothness: 0.2,
      rounding: 0.93,
      progressKeys: [
        { time: 0.44, progress: 0.64 },
        { time: 1, progress: 1 },
      ],
    },
    {
      name: 'RD 2.7 Side Low Strafe',
      // Low side profile strafe — Seedance 2.7
      anchors: [
        camPos(f, Math.PI * 0.52, hl * 2.4, low),
        camPos(f, Math.PI * 0.5, hl * 1.5, low + 0.05),
        camPos(f, Math.PI * 0.48, hl * 1.42, mid * 0.92),
        camPos(f, Math.PI * 0.42, hl * 2.1, mid),
      ],
      closed: false,
      lookAt: 'target',
      target: f.deck,
      fov: 70,
      roll: 6,
      smoothness: 0.16,
      rounding: 0.87,
      progressKeys: [
        { time: 0.38, progress: 0.66 },
        { time: 1, progress: 1 },
      ],
    },
    {
      name: 'RD 2.12 3/4 Front Sea Rise',
      // Sea-level 3/4 front rising reveal — Seedance 2.12
      anchors: [
        camPos(f, -Math.PI * 0.22, hl * 2.6, sea),
        camPos(f, -Math.PI * 0.18, hl * 1.9, low),
        camPos(f, -Math.PI * 0.14, hl * 1.5, mid),
        camPos(f, -Math.PI * 0.1, hl * 1.35, mid + hl * 0.18),
      ],
      closed: false,
      lookAt: 'target',
      target: f.bow,
      fov: 66,
      roll: -5,
      smoothness: 0.24,
      rounding: 0.91,
      progressKeys: [
        { time: 0.5, progress: 0.6 },
        { time: 1, progress: 1 },
      ],
    },
    {
      name: 'RD 1.4 Rear Lounge Tight',
      // Tight overhead rear / lounge — Seedance 1.4
      anchors: [
        overheadPos(f, Math.PI * 0.92, hl * 1.25, hl * 2.2),
        overheadPos(f, Math.PI, hl * 1.05, hl * 1.95),
        overheadPos(f, Math.PI * 1.08, hl * 1.1, hl * 1.85),
        overheadPos(f, Math.PI * 1.15, hl * 1.35, hl * 2.05),
      ],
      closed: false,
      lookAt: 'target',
      target: f.stern,
      fov: 56,
      roll: 2,
      smoothness: 0.22,
      rounding: 0.95,
      progressKeys: [
        { time: 0.46, progress: 0.63 },
        { time: 1, progress: 1 },
      ],
    },
  ]
}

export function applyRacingDroneCameraSpec(spec: RacingDroneCameraSpec, durationSeconds = 10) {
  beginGeneratedCameraOption(spec.name)
  const path = usePathStore.getState()
  const prevActive = path.activePathId
  path.setActivePath(CAMERA_PATH_ID)
  path.setPath(spec.anchors, spec.closed)
  path.setRounding(spec.rounding)
  path.setDrawPlaneY(yachtFrame().deckY)
  usePathStore.getState().setActivePath(prevActive)

  const rig = useRigStore.getState()
  rig.setDuration(durationSeconds)
  rig.setLoop(false)
  rig.setSmoothness(spec.smoothness)
  rig.setLookAtMode(spec.lookAt)
  rig.setTarget(spec.target)
  rig.setFov(spec.fov)
  rig.setRoll(spec.roll)
  rig.clearProgressKeys()
  for (const key of spec.progressKeys ?? []) {
    rig.upsertProgressKey(key.time, key.progress)
  }
  useCameraOptionsStore.getState().captureActive()
  useEditorStore.getState().select('cinema-camera')
}

function removeExistingRacingDroneOptions() {
  const store = useCameraOptionsStore.getState()
  for (const option of store.options.filter((o) => o.name.startsWith('RD '))) {
    if (useCameraOptionsStore.getState().options.length <= 1) break
    useCameraOptionsStore.getState().removeOption(option.id)
  }
}

export function generateRacingDroneCameras(count = 10, durationSeconds = 10, replaceExisting = true) {
  if (replaceExisting) removeExistingRacingDroneOptions()
  const specs = buildRacingDroneCameraSpecs(durationSeconds).slice(0, count)
  const created: string[] = []
  for (const spec of specs) {
    applyRacingDroneCameraSpec(spec, durationSeconds)
    created.push(spec.name)
  }
  useSceneStore.getState().showNotice(
    `Generated ${created.length} racing-drone cameras (${durationSeconds}s, reframed)`,
  )
  return created
}
