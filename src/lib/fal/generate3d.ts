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
    { signal: opts.signal, onQueueUpdate: opts.onQueueUpdate },
  )
  return requireModelGlb(data, TRIPO_H31_TEXT_TO_3D)
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
    {
      image_url: opts.imageUrl,
      model_type: 'standard',
      should_texture: false,
      enable_pbr: false,
      should_remesh: true,
      target_polycount: MESHY_TARGET_POLYCOUNT,
      topology: 'triangle',
    },
    { signal: opts.signal, onQueueUpdate: opts.onQueueUpdate },
  )
  return requireModelGlb(data, MESHY_V7_IMAGE_TO_3D)
}
