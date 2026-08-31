import { subscribe, type FalSubscribeOpts } from './client'
import { requireModelGlb } from './files'
import { TRIPO_REMESH } from './models'

/** Fal `tripo3d/tripo/remesh` triangle range. Adaptive (omit `face_limit`) smashed SAM clay. */
export const TRIPO_REMESH_FACE_MIN = 500
export const TRIPO_REMESH_FACE_MAX = 20_000
/** Keep half the source faces when that still fits the Fal cap. */
export const REMESH_KEEP_RATIO = 0.5

export function remeshFaceLimit(sourceTriangles: number): number {
  if (!Number.isFinite(sourceTriangles) || sourceTriangles <= 0) return TRIPO_REMESH_FACE_MAX
  return Math.min(
    TRIPO_REMESH_FACE_MAX,
    Math.max(TRIPO_REMESH_FACE_MIN, Math.round(sourceTriangles * REMESH_KEEP_RATIO)),
  )
}

export async function remeshGlb(opts: {
  meshUrl: string
  /** Source triangle count; used to pick `face_limit` when `faceLimit` is omitted. */
  sourceTriangles?: number
  faceLimit?: number
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<string> {
  const requested =
    opts.faceLimit ??
    (opts.sourceTriangles != null ? remeshFaceLimit(opts.sourceTriangles) : TRIPO_REMESH_FACE_MAX)
  const face_limit = Math.min(TRIPO_REMESH_FACE_MAX, Math.max(TRIPO_REMESH_FACE_MIN, Math.round(requested)))
  const data = await subscribe<{
    model_mesh?: { url?: string; file_name?: string }
    model_glb?: { url?: string }
    model_urls?: { glb?: { url?: string } }
  }>(
    TRIPO_REMESH,
    {
      mesh_url: opts.meshUrl,
      quad: false,
      bake: false,
      face_limit,
    },
    { signal: opts.signal, logs: true, onQueueUpdate: opts.onQueueUpdate },
  )
  return requireModelGlb(data, TRIPO_REMESH)
}
