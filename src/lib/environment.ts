import type { Transform } from '../state/useSceneStore'

export type EnvironmentSource = 'triposplat' | 'import'
export type RigKind = 'dummy' | 'sam-person' | 'none'
export type EnvironmentFormat = 'ply' | 'splat'

export interface ProjectEnvironment {
  id: string
  name: string
  bufferKey: string
  source: EnvironmentSource
  createdAt: number
  /** Stored so a stripped library name still reloads `.splat` as splat, not ply. */
  format?: EnvironmentFormat
  /** JPEG/PNG of the generate photo, for Find objects (E16). */
  sourceImageKey?: string
}

export interface ProjectMeshAsset {
  id: string
  name: string
  bufferKey: string
  rigKind: RigKind
}

export const IDENTITY_ENV_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
}

export function cloneEnvTransform(transform?: Transform | null): Transform {
  const src = transform ?? IDENTITY_ENV_TRANSFORM
  return {
    position: [...src.position],
    rotation: [...src.rotation],
    scale: [...src.scale],
  }
}

export function patchEnvTransform(
  transform: Transform,
  part: 'position' | 'rotation' | 'scale',
  axis: 0 | 1 | 2,
  value: number,
  uniformScale = false,
): Transform {
  const next = cloneEnvTransform(transform)
  if (part === 'scale' && uniformScale) {
    next.scale = [value, value, value]
    return next
  }
  next[part] = [...next[part]] as Transform['position']
  next[part][axis] = value
  return next
}

export function environmentFileKind(name: string): EnvironmentFormat | null {
  if (/\.ply$/i.test(name)) return 'ply'
  if (/\.splat$/i.test(name)) return 'splat'
  return null
}

export function partitionDroppedSceneFiles(files: File[]): {
  models: File[]
  environments: File[]
} {
  const models: File[] = []
  const environments: File[] = []
  for (const file of files) {
    if (/\.(glb|gltf)$/i.test(file.name)) models.push(file)
    else if (environmentFileKind(file.name)) environments.push(file)
  }
  return { models, environments }
}

export function environmentRecordFormat(record: {
  name: string
  format?: EnvironmentFormat | null
}): EnvironmentFormat {
  return record.format ?? environmentFileKind(record.name) ?? 'ply'
}

/**
 * Tiny INRIA-style binary Gaussian PLY (a few colored blobs). Used to prove the
 * compositor without a Fal generate. ASCII PLY is rejected by the splat loader.
 */
export function makeFixtureSplatPly(): ArrayBuffer {
  const C0 = 0.28209479177387814
  const sh = (channel: number) => (channel - 0.5) / C0
  const opacity = Math.log(0.92 / 0.08)
  const scale = Math.log(0.35)
  const verts = [
    [0, 0.35, 0, 1, 0.2, 0.12],
    [0.7, 0.35, 0, 0.2, 0.75, 1],
    [-0.7, 0.35, 0, 0.95, 0.9, 0.2],
    [0, 0.35, 0.7, 0.85, 0.3, 0.95],
  ]
  const header = `ply
format binary_little_endian 1.0
element vertex ${verts.length}
property float x
property float y
property float z
property float nx
property float ny
property float nz
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
`
  const headerBytes = new TextEncoder().encode(header)
  const body = new ArrayBuffer(verts.length * 17 * 4)
  const view = new DataView(body)
  verts.forEach((vert, index) => {
    const [x, y, z, r, g, b] = vert
    const values = [x, y, z, 0, 1, 0, sh(r), sh(g), sh(b), opacity, scale, scale, scale, 1, 0, 0, 0]
    values.forEach((value, offset) => {
      view.setFloat32((index * 17 + offset) * 4, value, true)
    })
  })
  const out = new Uint8Array(headerBytes.byteLength + body.byteLength)
  out.set(headerBytes, 0)
  out.set(new Uint8Array(body), headerBytes.byteLength)
  return out.buffer
}

/** Editor clay composites; export clay hides the splat; Look shows it (E3, E15). */
export function showEnvironmentSplat(viewMode: string, recording: boolean): boolean {
  if (viewMode === 'look') return true
  if (viewMode === 'clay' && !recording) return true
  return false
}

export function assignEnvironmentId(
  currentId: string | null | undefined,
  nextId: string,
  currentTransform?: Transform | null,
): { environmentId: string; environmentTransform: Transform } {
  if (currentId === nextId) {
    return {
      environmentId: nextId,
      environmentTransform: cloneEnvTransform(currentTransform),
    }
  }
  return { environmentId: nextId, environmentTransform: cloneEnvTransform(IDENTITY_ENV_TRANSFORM) }
}

export function environmentInUseCount(
  scenes: { environmentId?: string | null }[],
  environmentId: string,
): number {
  return scenes.filter((scene) => scene.environmentId === environmentId).length
}

export function environmentDeleteMessage(
  scenes: { environmentId?: string | null }[],
  environmentId: string,
): string | null {
  const n = environmentInUseCount(scenes, environmentId)
  if (n === 0) return null
  return n === 1 ? 'Used in 1 scene' : `Used in ${n} scenes`
}

export function collectProjectBufferKeys(
  environments: ProjectEnvironment[],
  unplaced: ProjectMeshAsset[],
): string[] {
  const keys: string[] = []
  for (const environment of environments) {
    keys.push(environment.bufferKey)
    if (environment.sourceImageKey) keys.push(environment.sourceImageKey)
  }
  for (const asset of unplaced) keys.push(asset.bufferKey)
  return keys
}
