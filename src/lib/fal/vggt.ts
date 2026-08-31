import { subscribe, type FalSubscribeOpts } from './client'
import { falFileUrl, falLooksLikeGlb } from './files'
import { VGGT_1B } from './models'

type FalFile = { url?: string; file_name?: string } | string

/** Fal API max. The Generate tile caps lower so the queue stays cheap. */
export const VGGT_MAX_API_VIEWS = 48
/** UI / job cap — overlapping stills, not a full SfM dump. */
export const VGGT_MAX_VIEWS = 12
export const VGGT_MAX_POINTS = 250_000

function isVggtStill(file: File): boolean {
  if (/^image\/(jpeg|png|webp)$/i.test(file.type)) return true
  return /\.(jpe?g|png|webp)$/i.test(file.name)
}

export function stillsForVggt(files: File[]): File[] {
  if (files.length === 0) throw new Error('Drop at least one overlapping photo.')
  if (files.length > VGGT_MAX_VIEWS) {
    throw new Error(`From views accepts at most ${VGGT_MAX_VIEWS} stills.`)
  }
  for (const file of files) {
    if (!isVggtStill(file)) throw new Error('VGGT accepts JPEG, PNG, or WEBP stills.')
  }
  return files
}

export function vggtPointCloudInput(imageUrls: string[]): Record<string, unknown> {
  if (imageUrls.length === 0) throw new Error('Drop at least one overlapping photo.')
  if (imageUrls.length > VGGT_MAX_API_VIEWS) {
    throw new Error(`VGGT accepts at most ${VGGT_MAX_API_VIEWS} stills.`)
  }
  return {
    image_urls: imageUrls,
    export_point_cloud: true,
    export_prediction_data: false,
    export_depth_maps: false,
    confidence_percentile: 50,
    max_points: VGGT_MAX_POINTS,
    enable_safety_checker: true,
  }
}

type VggtOutput = {
  point_cloud?: FalFile
  num_frames?: number
}

export async function reconstructViews(opts: {
  imageUrls: string[]
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<{ glbUrl: string; numFrames: number }> {
  const input = vggtPointCloudInput(opts.imageUrls)
  const data = await subscribe<VggtOutput>(VGGT_1B, input, {
    logs: true,
    signal: opts.signal,
    onQueueUpdate: opts.onQueueUpdate,
  })
  const glbUrl = falFileUrl(data.point_cloud)
  if (!glbUrl || !falLooksLikeGlb(data.point_cloud)) {
    throw new Error(`${VGGT_1B} returned no point-cloud GLB.`)
  }
  return { glbUrl, numFrames: data.num_frames ?? opts.imageUrls.length }
}
