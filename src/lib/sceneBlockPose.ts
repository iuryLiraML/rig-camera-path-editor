import type { Transform, Vec3 } from '../state/useSceneStore'

/** Dummy / SAM body target height in Rig units (B8). */
export const RIG_PERSON_HEIGHT = 2
/** Assumed SAM body height in metres until the Fal smoke measures otherwise. */
export const SAM_PERSON_METRES = 1.7
export const SAM_METRES_TO_RIG = RIG_PERSON_HEIGHT / SAM_PERSON_METRES

/**
 * OpenCV-style reconstruction (Y down, Z forward) → Rig (Y up, Z toward camera).
 * Smoke-tunable (B8 / B15).
 */
export function samPointToRig(point: Vec3): Vec3 {
  return [point[0], -point[1], -point[2]]
}

export function samEulerDegToRig(euler: Vec3): Vec3 {
  return [euler[0], -euler[1], -euler[2]]
}

function asNumbers(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((n) => typeof n === 'number')) return value as number[]
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    if (typeof rec.x === 'number' && typeof rec.y === 'number' && typeof rec.z === 'number') {
      return [rec.x, rec.y, rec.z]
    }
  }
  return null
}

function toVec3(value: unknown, fallback: Vec3): Vec3 {
  const nums = asNumbers(value)
  if (!nums || nums.length < 3) return fallback
  return [nums[0], nums[1], nums[2]]
}

function toDegrees(euler: Vec3): Vec3 {
  const maxAbs = Math.max(Math.abs(euler[0]), Math.abs(euler[1]), Math.abs(euler[2]))
  if (maxAbs <= Math.PI + 0.01) {
    return [(euler[0] * 180) / Math.PI, (euler[1] * 180) / Math.PI, (euler[2] * 180) / Math.PI]
  }
  return euler
}

/** Best-effort read of SAM 3D Objects / Align pose blobs. */
export function parseSamPose(raw: unknown): { translation: Vec3; rotationDeg: Vec3 } {
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const translation = toVec3(rec.translation ?? rec.position ?? rec.t, [0, 0, 0])
  const rotationRaw = rec.rotation_euler ?? rec.euler ?? rec.rotation ?? rec.r
  const rotationDeg = toDegrees(toVec3(rotationRaw, [0, 0, 0]))
  return { translation, rotationDeg }
}

export function layoutBlockTransforms(
  poses: Array<{ translation: Vec3; rotationDeg: Vec3 }>,
): Transform[] {
  const mapped = poses.map((pose) => {
    const rig = samPointToRig(pose.translation)
    return {
      position: [rig[0] * SAM_METRES_TO_RIG, rig[1] * SAM_METRES_TO_RIG, rig[2] * SAM_METRES_TO_RIG] as Vec3,
      rotation: samEulerDegToRig(pose.rotationDeg),
      scale: [1, 1, 1] as Vec3,
    }
  })
  let minY = 0
  for (const item of mapped) minY = Math.min(minY, item.position[1])
  if (minY >= 0) return mapped
  const lift = -minY
  return mapped.map((item) => ({
    ...item,
    position: [item.position[0], item.position[1] + lift, item.position[2]] as Vec3,
  }))
}

const BLOCK_SCENE_RE =
  /\b(?:block(?:ing)? this (?:scene|shot|set)|block the scene|quero blocar|blocar (?:essa|esta|a) cena)\b/i

export function isBlockSceneRequest(text: string): boolean {
  return BLOCK_SCENE_RE.test(text.trim())
}
