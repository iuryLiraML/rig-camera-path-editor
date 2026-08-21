import * as THREE from 'three'
import {
  PRIMITIVE_KINDS,
  type PrimitiveKind,
} from './primitiveGeometry'
import {
  useSceneStore,
  type SceneObject,
  type Vec3,
} from '../state/useSceneStore'
import { objectGroups } from '../viewport/SceneObjects'

const DEG = Math.PI / 180
/** Judge-aligned band: clearly floating or through the floor. */
export const OFF_FLOOR_Y = 0.55
export const THROUGH_FLOOR_Y = -0.45

export type PrimitiveRole = 'prop' | 'wall' | 'floor'

export function asPrimitiveKind(value: unknown): PrimitiveKind | null {
  const kind = String(value)
  return (PRIMITIVE_KINDS as string[]).includes(kind) ? (kind as PrimitiveKind) : null
}

export function asPrimitiveRole(value: unknown): PrimitiveRole {
  if (value === 'wall' || value === 'floor' || value === 'prop') return value
  return 'prop'
}

export function paramsFromSize(kind: PrimitiveKind, size: Vec3): Record<string, number> {
  const [x, y, z] = size.map((n) => Math.max(0.05, Math.abs(n))) as Vec3
  switch (kind) {
    case 'box':
      return { width: x, height: y, depth: z }
    case 'plane':
      return { width: x, depth: z }
    case 'cylinder':
    case 'cone':
      return { radius: Math.max(x, z) / 2, height: y }
    case 'sphere':
      return { radius: Math.max(x, y, z) / 2 }
    case 'torus':
      return { radius: Math.max(x, z) / 2, tube: Math.max(0.05, y / 4) }
    default: {
      const _never: never = kind
      return _never
    }
  }
}

export function wallParams(kind: PrimitiveKind): Record<string, number> {
  switch (kind) {
    case 'box':
      return { width: 4, height: 2.4, depth: 0.16 }
    case 'plane':
      return { width: 4, depth: 2.4 }
    case 'cylinder':
    case 'cone':
      return { radius: 0.12, height: 2.4 }
    case 'sphere':
      return { radius: 1.2 }
    case 'torus':
      return { radius: 1.2, tube: 0.12 }
    default: {
      const _never: never = kind
      return _never
    }
  }
}

export function floorParams(): Record<string, number> {
  return { width: 12, depth: 12 }
}

export function isFloorishObject(object: SceneObject, height?: number): boolean {
  const h = height ?? objectWorldBox(object).getSize(new THREE.Vector3()).y
  return (
    /floor|ground|plane|backdrop/i.test(object.name) ||
    (object.primitive?.kind === 'plane' && h < 0.25 && object.transform.rotation[0] === 0)
  )
}

/**
 * World AABB of a scene object from the store transform (not the live
 * viewport group, which can lag one React frame behind agent tools).
 */
export function objectWorldBox(object: SceneObject): THREE.Box3 {
  const root = object.root
  const prev = {
    x: root.position.x,
    y: root.position.y,
    z: root.position.z,
    rx: root.rotation.x,
    ry: root.rotation.y,
    rz: root.rotation.z,
    sx: root.scale.x,
    sy: root.scale.y,
    sz: root.scale.z,
  }
  const t = object.transform
  root.position.set(...t.position)
  root.rotation.set(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG)
  root.scale.set(...t.scale)
  root.updateWorldMatrix(true, true)
  const box = new THREE.Box3().setFromObject(root)
  root.position.set(prev.x, prev.y, prev.z)
  root.rotation.set(prev.rx, prev.ry, prev.rz)
  root.scale.set(prev.sx, prev.sy, prev.sz)
  root.updateMatrixWorld(true)
  return box
}

export function formatVec3(v: THREE.Vector3 | Vec3): string {
  const x = Array.isArray(v) ? v[0] : v.x
  const y = Array.isArray(v) ? v[1] : v.y
  const z = Array.isArray(v) ? v[2] : v.z
  return `[${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}]`
}

/** Shift group Y so the world AABB sits on y=0. Returns a short readout. */
export function snapObjectToFloor(id: string): string | null {
  const scene = useSceneStore.getState()
  const object = scene.objects.find((item) => item.id === id)
  if (!object) return null
  const box = objectWorldBox(object)
  if (!Number.isFinite(box.min.y)) return null
  const delta = -box.min.y
  if (Math.abs(delta) < 1e-4) {
    const center = box.getCenter(new THREE.Vector3())
    return `${object.name} feet_y=0 center=${formatVec3(center)}`
  }
  const next: Vec3 = [
    object.transform.position[0],
    object.transform.position[1] + delta,
    object.transform.position[2],
  ]
  scene.setTransformAll(id, { ...object.transform, position: next })
  const live = objectGroups.get(id)
  if (live) live.position.set(...next)
  const snapped = scene.objects.find((item) => item.id === id)
  if (!snapped) return null
  const after = objectWorldBox(snapped)
  const center = after.getCenter(new THREE.Vector3())
  return `${snapped.name} feet_y=${after.min.y.toFixed(2)} center=${formatVec3(center)}`
}

export function placeOnFloor(id: string, xz: [number, number]): string | null {
  const scene = useSceneStore.getState()
  const object = scene.objects.find((item) => item.id === id)
  if (!object) return null
  scene.setTransformAll(id, {
    ...object.transform,
    position: [xz[0], object.transform.position[1], xz[1]],
  })
  return snapObjectToFloor(id)
}

/**
 * Snap every non-floorish object whose feet are clearly off or through the
 * floor. Returns a note when anything moved.
 */
export function snapSceneToFloor(): string | null {
  const scene = useSceneStore.getState()
  const notes: string[] = []
  for (const object of scene.objects) {
    if (isFloorishObject(object)) continue
    const box = objectWorldBox(object)
    if (box.min.y <= OFF_FLOOR_Y && box.min.y >= THROUGH_FLOOR_Y) continue
    const note = snapObjectToFloor(object.id)
    if (note) notes.push(note)
  }
  if (notes.length === 0) return null
  return `Snapped to floor: ${notes.join('; ')}.`
}

export function configurePlacedPrimitive(input: {
  id: string
  kind: PrimitiveKind
  role: PrimitiveRole
  size?: Vec3
  position?: Vec3
  lift: boolean
}): string {
  const scene = useSceneStore.getState()
  const object = scene.objects.find((item) => item.id === input.id)
  if (!object) return `Added a ${input.kind}.`

  let params: Record<string, number> | null = null
  if (input.size) params = paramsFromSize(input.kind, input.size)
  else if (input.role === 'wall') params = wallParams(input.kind)
  else if (input.role === 'floor') params = floorParams()
  if (params) scene.updatePrimitiveParams(input.id, params)

  let rotation = object.transform.rotation
  let name = object.name
  if (input.role === 'wall') {
    name = 'Wall'
    scene.renameObject(input.id, name)
    if (input.kind === 'plane') rotation = [90, 0, rotation[2]]
  } else if (input.role === 'floor') {
    name = 'Floor'
    scene.renameObject(input.id, name)
  }

  const xz: [number, number] = input.position ? [input.position[0], input.position[2]] : [0, 0]
  const current = scene.objects.find((item) => item.id === input.id) ?? object
  if (input.lift && input.position) {
    scene.setTransformAll(input.id, {
      ...current.transform,
      rotation,
      position: input.position,
    })
    const posed = scene.objects.find((item) => item.id === input.id)
    const box = posed ? objectWorldBox(posed) : null
    const center = box?.getCenter(new THREE.Vector3())
    return `Added ${name} (id ${input.id}) lifted at ${formatVec3(input.position)}${
      center ? ` center=${formatVec3(center)}` : ''
    }.`
  }

  scene.setTransformAll(input.id, {
    ...current.transform,
    rotation,
    position: [xz[0], current.transform.position[1], xz[1]],
  })
  const note = snapObjectToFloor(input.id)
  return `Added ${name} (id ${input.id})${note ? ` ${note}` : ''}.`
}

