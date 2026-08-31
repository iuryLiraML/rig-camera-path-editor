import { subscribe, type FalSubscribeOpts } from './client'
import { requireModelGlb } from './files'
import {
  GENERATE_FACE_LIMIT,
  MESHY_TARGET_POLYCOUNT,
  MESHY_V7_IMAGE_TO_3D,
  TRIPO_H31_TEXT_TO_3D,
} from './models'

export async function generateFromText(opts: {
  prompt: string
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<string> {
  const prompt = opts.prompt.trim()
  if (!prompt) throw new Error('Describe the object to generate.')
  const data = await subscribe<{
    model_mesh?: { url?: string; file_name?: string }
    model_glb?: { url?: string }
    model_urls?: { glb?: { url?: string } }
  }>(
    TRIPO_H31_TEXT_TO_3D,
    {
      prompt,
      texture: false,
      pbr: false,
      face_limit: GENERATE_FACE_LIMIT,
      geometry_quality: 'standard',
    },
    { signal: opts.signal, logs: true, onQueueUpdate: opts.onQueueUpdate },
  )
  return requireModelGlb(data, TRIPO_H31_TEXT_TO_3D)
}

/** Clay From image: omit enable_pbr — Meshy 422s it unless should_texture is true. */
export function meshyClayImageInput(imageUrl: string): Record<string, unknown> {
  return {
    image_url: imageUrl,
    model_type: 'standard',
    should_texture: false,
    should_remesh: true,
    target_polycount: MESHY_TARGET_POLYCOUNT,
    topology: 'triangle',
  }
}

export function meshyAcceptsStill(file: File): boolean {
  if (file.type === 'image/jpeg' || file.type === 'image/png') return true
  return /\.(jpe?g|png)$/i.test(file.name) && (!file.type || file.type === 'application/octet-stream')
}

export function stillForMeshy(file: File): File {
  if (meshyAcceptsStill(file)) return file
  throw new Error('Meshy accepts JPEG or PNG. Convert the photo or use From text.')
}

export async function generateFromImage(opts: {
  imageUrl: string
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<string> {
  const data = await subscribe<{
    model_glb?: { url?: string }
    model_urls?: { glb?: { url?: string } }
  }>(
    MESHY_V7_IMAGE_TO_3D,
    meshyClayImageInput(opts.imageUrl),
    { signal: opts.signal, logs: true, onQueueUpdate: opts.onQueueUpdate },
  )
  return requireModelGlb(data, MESHY_V7_IMAGE_TO_3D)
}
