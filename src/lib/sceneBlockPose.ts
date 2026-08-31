import * as THREE from 'three'
import type { Transform, Vec3 } from '../state/useSceneStore'

/** Dummy / SAM body target height in Rig units (B8). */
export const RIG_PERSON_HEIGHT = 2
/** Assumed SAM body height in metres until the Fal smoke measures otherwise. */
export const SAM_PERSON_METRES = 1.7
export const SAM_METRES_TO_RIG = RIG_PERSON_HEIGHT / SAM_PERSON_METRES

/**
 * SAM 3D Objects layout (translation / rotation / scale) is Z-up camera space.
 * The GLB already had Z-up → Y-up baked into vertices (Meta sam-3d-objects #56).
 * Applying Z-up Euler onto that mesh is the “objects lying on their right side” smoke.
 * Smoke-tunable (B8 / B15): Rx(-90°) maps (x, y, z)_zup → (x, z, -y)_yup.
 */
const ZUP_TO_YUP = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
const YUP_TO_ZUP = new THREE.Matrix4().makeRotationX(Math.PI / 2)

/** Z-up metres → Rig Y-up. */
export function samPointToRig(point: Vec3): Vec3 {
  return [point[0], point[2], -point[1]]
}

export function samEulerDegToRig(euler: Vec3): Vec3 {
  const zUp = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(euler[0]),
      THREE.MathUtils.degToRad(euler[1]),
      THREE.MathUtils.degToRad(euler[2]),
      'XYZ',
    ),
  )
  const yUp = ZUP_TO_YUP.clone().multiply(zUp).multiply(YUP_TO_ZUP)
  const out = new THREE.Euler().setFromRotationMatrix(yUp, 'XYZ')
  return [
    THREE.MathUtils.radToDeg(out.x),
    THREE.MathUtils.radToDeg(out.y),
    THREE.MathUtils.radToDeg(out.z),
  ]
}

function firstNumericRow(value: unknown): number[] | null {
  if (Array.isArray(value) && value.length > 0) {
    if (value.every((n) => typeof n === 'number')) return value as number[]
    return firstNumericRow(value[0])
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    if (typeof rec.x === 'number' && typeof rec.y === 'number' && typeof rec.z === 'number') {
      const w = typeof rec.w === 'number' ? rec.w : undefined
      return w == null ? [rec.x, rec.y, rec.z] : [rec.x, rec.y, rec.z, w]
    }
  }
  return null
}

function isMat3(value: unknown): value is number[][] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (row) => Array.isArray(row) && row.length === 3 && row.every((n) => typeof n === 'number'),
    )
  )
}

function toVec3(value: unknown, fallback: Vec3): Vec3 {
  const nums = firstNumericRow(value)
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

function quatToEulerDeg(nums: number[]): Vec3 {
  const quat =
    nums.length >= 4
      ? new THREE.Quaternion(nums[0], nums[1], nums[2], nums[3])
      : new THREE.Quaternion()
  const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ')
  return [
    THREE.MathUtils.radToDeg(euler.x),
    THREE.MathUtils.radToDeg(euler.y),
    THREE.MathUtils.radToDeg(euler.z),
  ]
}

function mat3ToEulerDeg(n: number[][]): Vec3 {
  const m = new THREE.Matrix4().set(
    n[0][0],
    n[0][1],
    n[0][2],
    0,
    n[1][0],
    n[1][1],
    n[1][2],
    0,
    n[2][0],
    n[2][1],
    n[2][2],
    0,
    0,
    0,
    0,
    1,
  )
  const euler = new THREE.Euler().setFromRotationMatrix(m, 'XYZ')
  return [
    THREE.MathUtils.radToDeg(euler.x),
    THREE.MathUtils.radToDeg(euler.y),
    THREE.MathUtils.radToDeg(euler.z),
  ]
}

function parseRotationDeg(value: unknown): Vec3 {
  if (isMat3(value)) return mat3ToEulerDeg(value)
  if (Array.isArray(value) && value.length === 1 && isMat3(value[0])) {
    return mat3ToEulerDeg(value[0])
  }
  const nums = firstNumericRow(value)
  if (!nums) return [0, 0, 0]
  if (nums.length === 9) {
    return mat3ToEulerDeg([
      [nums[0], nums[1], nums[2]],
      [nums[3], nums[4], nums[5]],
      [nums[6], nums[7], nums[8]],
    ])
  }
  if (nums.length >= 4) return quatToEulerDeg(nums)
  return toDegrees([nums[0], nums[1], nums[2]])
}

function parseScale(raw: Record<string, unknown>): Vec3 {
  if (typeof raw.scale_factor === 'number' && Number.isFinite(raw.scale_factor) && raw.scale_factor > 0) {
    const s = raw.scale_factor
    return [s, s, s]
  }
  return toVec3(raw.scale ?? raw.s, [1, 1, 1])
}

/** Best-effort read of SAM 3D Objects / Align pose blobs. */
export function parseSamPose(raw: unknown): { translation: Vec3; rotationDeg: Vec3; scale: Vec3 } {
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const translation = toVec3(rec.translation ?? rec.position ?? rec.t ?? rec.pred_cam_t, [0, 0, 0])
  const rotationDeg = parseRotationDeg(rec.rotation_euler ?? rec.euler ?? rec.rotation ?? rec.r ?? rec.global_rot)
  const scale = parseScale(rec)
  return { translation, rotationDeg, scale }
}

export function readFocalLength(raw: unknown): number | undefined {
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const nested = rec.people
  const fromPerson =
    Array.isArray(nested) && nested[0] && typeof nested[0] === 'object'
      ? (nested[0] as Record<string, unknown>).focal_length
      : undefined
  const value = rec.focal_length ?? fromPerson
  return typeof value === 'number' && value > 0 ? value : undefined
}

export function layoutBlockTransforms(
  poses: Array<{ translation: Vec3; rotationDeg: Vec3; scale?: Vec3 }>,
): Transform[] {
  const mapped = poses.map((pose) => {
    const rig = samPointToRig(pose.translation)
    const scale = pose.scale ?? [1, 1, 1]
    return {
      position: [rig[0] * SAM_METRES_TO_RIG, rig[1] * SAM_METRES_TO_RIG, rig[2] * SAM_METRES_TO_RIG] as Vec3,
      rotation: samEulerDegToRig(pose.rotationDeg),
      scale: [
        scale[0] * SAM_METRES_TO_RIG,
        scale[1] * SAM_METRES_TO_RIG,
        scale[2] * SAM_METRES_TO_RIG,
      ] as Vec3,
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
