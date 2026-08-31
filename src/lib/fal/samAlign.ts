import { subscribe, type FalSubscribeOpts } from './client'
import { SAM_3D_ALIGN } from './models'

type FalFile = { url?: string } | string

function fileUrl(file: FalFile | undefined): string | null {
  if (!file) return null
  if (typeof file === 'string') return file
  return file.url ?? null
}

export async function alignBodyToImage(opts: {
  imageUrl: string
  bodyMeshUrl: string
  bodyMaskUrl?: string
  objectMeshUrl?: string
  focalLength?: number
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<{ metadata?: unknown; glbUrl?: string; sceneGlbUrl?: string }> {
  const data = await subscribe<{
    metadata?: unknown
    model_glb?: FalFile
    scene_glb?: FalFile
  }>(
    SAM_3D_ALIGN,
    {
      image_url: opts.imageUrl,
      body_mesh_url: opts.bodyMeshUrl,
      ...(opts.bodyMaskUrl ? { body_mask_url: opts.bodyMaskUrl } : {}),
      ...(opts.objectMeshUrl ? { object_mesh_url: opts.objectMeshUrl } : {}),
      ...(opts.focalLength != null ? { focal_length: opts.focalLength } : {}),
    },
    { signal: opts.signal, onQueueUpdate: opts.onQueueUpdate },
  )
  return {
    metadata: data.metadata,
    glbUrl: fileUrl(data.model_glb) ?? undefined,
    sceneGlbUrl: fileUrl(data.scene_glb) ?? undefined,
  }
}
