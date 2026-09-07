import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three-stdlib'

export type PrimitiveKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'torus'

export interface PrimitiveSpec {
  kind: PrimitiveKind
  params: Record<string, number>
  ops?: CadOp[]
}

export type CadVec3 = [number, number, number]

/** A planar region identified geometrically, independent of tessellation indices. */
export interface CadFaceRef {
  normal: CadVec3
  anchor: CadVec3
}

export type CadOp =
  | { type: 'extrude'; face: CadFaceRef; distance: number }
  | { type: 'boolean'; mode: 'union' | 'subtract' | 'intersect'; operand: PrimitiveSpec; matrix: number[] }
  | { type: 'slice'; normal: CadVec3; offset: number; keep: 'positive' | 'negative' }


export interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
}

interface PrimitiveDef {
  label: string
  params: ParamDef[]
  build: (p: Record<string, number>) => THREE.BufferGeometry
}

const p = (key: string, label: string, min: number, max: number, step: number, def: number): ParamDef => ({
  key,
  label,
  min,
  max,
  step,
  default: def,
})

/** Rounded box with the corner radius clamped to a valid range for the given dims. */
function roundedBox(w: number, h: number, d: number, corner: number): THREE.BufferGeometry {
  const maxR = Math.min(w, h, d) / 2 - 1e-3
  const r = Math.max(0, Math.min(corner, maxR))
  if (r < 1e-3) return new THREE.BoxGeometry(w, h, d)
  // segments scale a little with radius so the fillet reads smooth
  const seg = Math.max(2, Math.round(r * 8))
  return new RoundedBoxGeometry(w, h, d, seg, r)
}

export const PRIMITIVE_DEFS: Record<PrimitiveKind, PrimitiveDef> = {
  box: {
    label: 'Box',
    params: [
      p('width', 'Width', 0.1, 8, 0.1, 1.4),
      p('height', 'Height', 0.1, 8, 0.1, 1.4),
      p('depth', 'Depth', 0.1, 8, 0.1, 1.4),
      p('corner', 'Corner', 0, 2, 0.02, 0.18),
    ],
    build: (o) => roundedBox(o.width, o.height, o.depth, o.corner),
  },
  sphere: {
    label: 'Sphere',
    params: [
      p('radius', 'Radius', 0.1, 5, 0.1, 1),
      p('segments', 'Detail', 8, 64, 1, 32),
    ],
    build: (o) => new THREE.SphereGeometry(o.radius, Math.round(o.segments), Math.round(o.segments / 2)),
  },
  cylinder: {
    label: 'Cylinder',
    params: [
      p('radius', 'Radius', 0.1, 5, 0.1, 0.8),
      p('height', 'Height', 0.1, 8, 0.1, 1.6),
      p('sides', 'Sides', 3, 64, 1, 32),
    ],
    build: (o) => new THREE.CylinderGeometry(o.radius, o.radius, o.height, Math.round(o.sides)),
  },
  cone: {
    label: 'Cone',
    params: [
      p('radius', 'Radius', 0.1, 5, 0.1, 0.9),
      p('height', 'Height', 0.1, 8, 0.1, 1.8),
      p('sides', 'Sides', 3, 64, 1, 32),
    ],
    build: (o) => new THREE.ConeGeometry(o.radius, o.height, Math.round(o.sides)),
  },
  plane: {
    label: 'Plane',
    params: [
      p('width', 'Width', 0.2, 12, 0.1, 3),
      p('depth', 'Depth', 0.2, 12, 0.1, 3),
      p('corner', 'Corner', 0, 1, 0.02, 0.1),
    ],
    // a thin solid slab, so it casts/receives shadows and reads as clay
    build: (o) => roundedBox(o.width, 0.06, o.depth, o.corner),
  },
  torus: {
    label: 'Torus',
    params: [
      p('radius', 'Radius', 0.2, 5, 0.1, 1),
      p('tube', 'Thickness', 0.05, 2, 0.05, 0.35),
      p('sides', 'Sides', 8, 64, 1, 32),
    ],
    build: (o) =>
      new THREE.TorusGeometry(o.radius, o.tube, Math.max(8, Math.round(o.sides / 2)), Math.round(o.sides)),
  },
}

export const PRIMITIVE_KINDS = Object.keys(PRIMITIVE_DEFS) as PrimitiveKind[]

export function defaultParams(kind: PrimitiveKind): Record<string, number> {
  const out: Record<string, number> = {}
  for (const def of PRIMITIVE_DEFS[kind].params) out[def.key] = def.default
  return out
}

export function buildPrimitiveSeedGeometry(spec: PrimitiveSpec): THREE.BufferGeometry {
  const def = PRIMITIVE_DEFS[spec.kind]
  const params = { ...defaultParams(spec.kind), ...spec.params }
  return def.build(params)
}

/** Y offset that rests the geometry's bounding box on the floor (y=0). */
export function floorOffsetY(geometry: THREE.BufferGeometry): number {
  geometry.computeBoundingBox()
  return -(geometry.boundingBox?.min.y ?? 0)
}
