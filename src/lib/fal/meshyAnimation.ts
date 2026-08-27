import { subscribe, type FalSubscribeOpts } from './client'
import { falFileUrl } from './files'
import { downloadGlb } from './lift'
import { MESHY_MULTI_ANIMATION } from './models'

/**
 * Curated Meshy action_ids from https://docs.meshy.ai/en/api/animation-library
 * (Idle, Walking_Woman, Run_02, Wave_One_Hand). Not the full 0–696 catalog.
 */
export const MESHY_CURATED_CLIPS = [
  { id: 0, label: 'Idle' },
  { id: 1, label: 'Walk' },
  { id: 14, label: 'Run' },
  { id: 290, label: 'Wave' },
] as const

type MeshyFile = { url?: string } | string

export async function animatePersonWithMeshy(opts: {
  modelUrl: string
  animationIds?: number[]
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<{ buffer: ArrayBuffer; extraBuffers: ArrayBuffer[] }> {
  const animation_action_ids = opts.animationIds ?? MESHY_CURATED_CLIPS.map((clip) => clip.id)
  const data = await subscribe<{
    model_glb?: MeshyFile
    animated_model?: MeshyFile
    rigged_character_glb?: MeshyFile
    animations?: { action_id?: number; animation_glb?: MeshyFile }[]
  }>(
    MESHY_MULTI_ANIMATION,
    {
      model_url: opts.modelUrl,
      animation_action_ids,
    },
    { signal: opts.signal, onQueueUpdate: opts.onQueueUpdate },
  )
  const clipUrls = (data.animations ?? [])
    .map((item) => falFileUrl(item.animation_glb))
    .filter((url): url is string => Boolean(url))
  const rigUrl =
    falFileUrl(data.rigged_character_glb) ??
    falFileUrl(data.model_glb) ??
    falFileUrl(data.animated_model) ??
    clipUrls[0]
  if (!rigUrl) throw new Error(`${MESHY_MULTI_ANIMATION} returned no GLB.`)
  const buffer = await downloadGlb(rigUrl, opts.signal)
  const extraBuffers = await Promise.all(
    clipUrls.filter((url) => url !== rigUrl).map((url) => downloadGlb(url, opts.signal)),
  )
  return { buffer, extraBuffers }
}
