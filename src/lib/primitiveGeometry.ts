import * as THREE from 'three'
import Module, { type Manifold, type Mat4 } from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import {
  buildPrimitiveSeedGeometry, defaultParams, PRIMITIVE_DEFS, floorOffsetY,
  type PrimitiveSpec, type CadFaceRef, type CadVec3,
} from './primitiveSeeds'
export * from './primitiveSeeds'

// Initialization is shared; only edits evaluate a solid, never the animation loop.
const kernel = await Module(import.meta.env.MODE === 'test' ? undefined : { locateFile: () => wasmUrl })
kernel.setup()

export interface CadFace {
  ref: CadFaceRef
  triangles: number[]
  normal: CadVec3
  center: CadVec3
  area: number
}
export interface CadTopology {
  faces: CadFace[]
  edges: [CadVec3, CadVec3][]
  triangleFaces: number[]
}

const cache = new Map<string, THREE.BufferGeometry>()
let evaluations = 0
export const primitiveEvaluationCount = () => evaluations
export function primitiveSpecKey(spec: PrimitiveSpec): string {
  return JSON.stringify(spec, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
}

function validateSpec(spec: PrimitiveSpec, depth = 0, budget = { remaining: 64 }) {
  if (!spec || !PRIMITIVE_DEFS[spec.kind] || depth > 8) throw new Error('Invalid primitive solid specification.')
  const params = { ...defaultParams(spec.kind), ...spec.params }
  for (const def of PRIMITIVE_DEFS[spec.kind].params) {
    const value = params[def.key]
    const detail = def.key === 'segments' || def.key === 'sides'
    const min = def.key === 'corner' ? 0 : detail ? def.min : 1e-4
    const max = detail ? 256 : 1000
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${def.label} must be between ${min} and ${max}.`)
  }
  if (spec.ops && (!Array.isArray(spec.ops) || spec.ops.length > 32)) throw new Error('A solid supports up to 32 operations.')
  for (const op of spec.ops ?? []) {
    if (--budget.remaining < 0) throw new Error('This solid has too many nested operations.')
    if (op.type === 'boolean') {
      if (!['union', 'subtract', 'intersect'].includes(op.mode) || !Array.isArray(op.matrix) || op.matrix.length !== 16 || !op.matrix.every(Number.isFinite)) throw new Error('Invalid boolean transform or mode.')
      const matrix = new THREE.Matrix4().fromArray(op.matrix)
      if (Math.abs(matrix.determinant()) < 1e-10 || op.matrix[3] !== 0 || op.matrix[7] !== 0 || op.matrix[11] !== 0 || op.matrix[15] !== 1) throw new Error('The cutter transform must be invertible and affine.')
      validateSpec(op.operand, depth + 1, budget)
    } else if (op.type === 'slice') {
      vector(op.normal)
      if (!Number.isFinite(op.offset) || !['positive', 'negative'].includes(op.keep)) throw new Error('Invalid slice plane.')
    } else if (op.type === 'extrude') {
      vector(op.face?.normal)
      if (!Array.isArray(op.face?.anchor) || op.face.anchor.length !== 3 || !op.face.anchor.every(Number.isFinite) || !Number.isFinite(op.distance) || Math.abs(op.distance) < 1e-5 || Math.abs(op.distance) > 100) throw new Error('Extrude distance must be nonzero and within 100 meters.')
    } else throw new Error('Unsupported solid operation.')
  }
}

function vector(values: CadVec3) {
  if (!Array.isArray(values) || values.length !== 3 || !values.every(Number.isFinite)) throw new Error('A finite three-component vector is required.')
  const v = new THREE.Vector3(...values)
  if (v.lengthSq() < 1e-12) throw new Error('The plane normal must not be zero.')
  return v.normalize()
}

function solidGeometry(solid: Manifold) {
  const normalSolid = solid.calculateNormals(0, 40)
  try {
    const mesh = normalSolid.getMesh()
    const positions = new Float32Array(mesh.numVert * 3)
    const normals = new Float32Array(mesh.numVert * 3)
    for (let i = 0; i < mesh.numVert; i++) {
      positions.set(mesh.vertProperties.subarray(i * mesh.numProp, i * mesh.numProp + 3), i * 3)
      normals.set(mesh.vertProperties.subarray(i * mesh.numProp + 3, i * mesh.numProp + 6), i * 3)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1))
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    geometry.userData.cadVolume = solid.volume()
    geometry.userData.cadTopology = topology(geometry)
    return geometry
  } finally { normalSolid.delete() }
}

/** Connected coplanar regions and their boundaries; triangle indices are runtime-only. */
function topology(geometry: THREE.BufferGeometry): CadTopology {
  const positions = geometry.getAttribute('position')
  const index = geometry.index!
  const size = geometry.boundingBox!.getSize(new THREE.Vector3())
  const min = geometry.boundingBox!.min
  const tolerance = Math.max(size.length() * 1e-6, 1e-7)
  const vertices = Array.from({ length: positions.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(positions, i))
  const vertexKey = (v: THREE.Vector3) => v.toArray().map((n) => Math.round(n / tolerance)).join(',')
  const triangles = Array.from({ length: index.count / 3 }, (_, i) => {
    const points = [0, 1, 2].map((j) => vertices[index.getX(i * 3 + j)])
    const cross = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]))
    const area = cross.length() / 2
    const normal = cross.normalize()
    return { points, normal, area, center: points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1 / 3) }
  })
  const edgeMap = new Map<string, { points: [CadVec3, CadVec3]; triangles: number[] }>()
  triangles.forEach((tri, i) => tri.points.forEach((a, j) => {
    const b = tri.points[(j + 1) % 3]
    const key = [vertexKey(a), vertexKey(b)].sort().join('|')
    const edge = edgeMap.get(key) ?? { points: [a.toArray(), b.toArray()], triangles: [] }
    edge.triangles.push(i)
    edgeMap.set(key, edge)
  }))
  const neighbors = triangles.map(() => [] as number[])
  for (const edge of edgeMap.values()) {
    if (edge.triangles.length !== 2) continue
    const [a, b] = edge.triangles
    if (triangles[a].normal.dot(triangles[b].normal) > 1 - 1e-7) {
      neighbors[a].push(b); neighbors[b].push(a)
    }
  }
  const triangleFaces = triangles.map(() => -1)
  const faces: CadFace[] = []
  triangles.forEach((tri, start) => {
    if (triangleFaces[start] !== -1) return
    const id = faces.length
    const pending = [start], members: number[] = []
    const center = new THREE.Vector3()
    let area = 0
    triangleFaces[start] = id
    while (pending.length) {
      const i = pending.pop()!
      members.push(i)
      area += triangles[i].area
      center.addScaledVector(triangles[i].center, triangles[i].area)
      for (const j of neighbors[i]) if (triangleFaces[j] === -1) { triangleFaces[j] = id; pending.push(j) }
    }
    center.multiplyScalar(1 / Math.max(area, 1e-12))
    const anchor = center.clone().sub(min).divide(new THREE.Vector3(Math.max(size.x, tolerance), Math.max(size.y, tolerance), Math.max(size.z, tolerance)))
    faces.push({ ref: { normal: tri.normal.toArray(), anchor: anchor.toArray() }, normal: tri.normal.toArray(), center: center.toArray(), area, triangles: members })
  })
  const edges = [...edgeMap.values()].filter((e) => e.triangles.length !== 2 || triangleFaces[e.triangles[0]] !== triangleFaces[e.triangles[1]]).map((e) => e.points)
  return { faces, edges, triangleFaces }
}

export function primitiveTopology(geometry: THREE.BufferGeometry): CadTopology {
  return geometry.userData.cadTopology as CadTopology
}

export function resolveCadFace(geometry: THREE.BufferGeometry, ref: CadFaceRef): CadFace {
  const normal = vector(ref.normal)
  const candidates = primitiveTopology(geometry).faces.filter((face) => normal.dot(new THREE.Vector3(...face.normal)) > 1 - 1e-6)
  candidates.sort((a, b) => new THREE.Vector3(...a.ref.anchor).distanceToSquared(new THREE.Vector3(...ref.anchor)) - new THREE.Vector3(...b.ref.anchor).distanceToSquared(new THREE.Vector3(...ref.anchor)))
  if (!candidates[0]) throw new Error('The selected planar face no longer exists. Select a face again.')
  return candidates[0]
}

function evaluate(spec: PrimitiveSpec): Manifold {
  const seed = buildPrimitiveSeedGeometry(spec)
  const input = new kernel.Mesh({ numProp: 3, vertProperties: new Float32Array(seed.getAttribute('position').array), triVerts: new Uint32Array(seed.index?.array ?? Array.from({ length: seed.getAttribute('position').count }, (_, i) => i)) })
  input.merge()
  seed.dispose()
  let solid = new kernel.Manifold(input)
  try {
    for (const op of spec.ops ?? []) {
      let next: Manifold
      if (op.type === 'boolean') {
        const source = evaluate(op.operand)
        let operand: Manifold | undefined
        try {
          operand = source.transform(op.matrix as Mat4)
          next = op.mode === 'union' ? solid.add(operand) : op.mode === 'subtract' ? solid.subtract(operand) : solid.intersect(operand)
        } finally { operand?.delete(); source.delete() }
      } else if (op.type === 'slice') {
        const sign = op.keep === 'positive' ? 1 : -1
        next = solid.trimByPlane(vector(op.normal).multiplyScalar(sign).toArray(), op.offset * sign)
      } else {
        const geometry = solidGeometry(solid)
        const prisms: Manifold[] = []
        let extrusion: Manifold | undefined
        try {
          const face = resolveCadFace(geometry, op.face)
          // A single facet of a curved surface is not an authoring face.
          if (face.triangles.length < 2) throw new Error('Select a planar surface to extrude.')
          const normal = new THREE.Vector3(...face.normal)
          for (const triangle of face.triangles) {
            const points = [0, 1, 2].map((i) => new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('position'), geometry.index!.getX(triangle * 3 + i)))
            const outer = op.distance < 0 ? 1e-5 : 0
            prisms.push(kernel.Manifold.hull([...points.map((v) => v.clone().addScaledVector(normal, outer).toArray()), ...points.map((v) => v.clone().addScaledVector(normal, op.distance).toArray())]))
          }
          extrusion = kernel.Manifold.union(prisms)
          next = op.distance > 0 ? solid.add(extrusion) : solid.subtract(extrusion)
        } finally { extrusion?.delete(); prisms.forEach((p) => p.delete()); geometry.dispose() }
      }
      solid.delete()
      solid = next
    }
    if (solid.status() !== 'NoError' || solid.isEmpty()) throw new Error('The operation produces an empty or invalid solid.')
    return solid
  } catch (error) { solid.delete(); throw error }
}

/** Caller owns the clone. The bounded cache retains only CPU tessellation, never WASM bodies. */
export function buildPrimitiveGeometry(spec: PrimitiveSpec): THREE.BufferGeometry {
  validateSpec(spec)
  const key = primitiveSpecKey(spec)
  let geometry = cache.get(key)
  if (!geometry) {
    evaluations++
    const solid = evaluate(spec)
    try { geometry = solidGeometry(solid) } finally { solid.delete() }
    const seed = buildPrimitiveSeedGeometry(spec)
    geometry.userData.cadSeedFloor = floorOffsetY(seed)
    seed.dispose()
    cache.set(key, geometry)
    if (cache.size > 48) {
      const oldest = cache.keys().next().value!
      cache.get(oldest)!.dispose()
      cache.delete(oldest)
    }
  }
  return geometry.clone()
}
