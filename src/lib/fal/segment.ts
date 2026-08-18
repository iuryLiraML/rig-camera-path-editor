import { subscribe, type FalSubscribeOpts } from './client'
import { SAM_IMAGE_MODELS, type SamImageVersion } from './models'

export type PointPrompt = { x: number; y: number; label?: 0 | 1; object_id?: number }
export type BoxPrompt = {
  x_min: number
  y_min: number
  x_max: number
  y_max: number
  object_id?: number
}

type SamImageFile = { url?: string }
type SamImageResult = {
  image?: SamImageFile
  masks?: SamImageFile[]
  scores?: number[]
  boxes?: number[][]
  metadata?: { box?: number[] }[]
}

export type SegmentResult = {
  maskUrl: string
  maskUrls: string[]
  boxes?: number[][]
  scores?: number[]
  modelId: string
}

/** Group photos need every instance; Fal defaults to a single mask. */
const MAX_PERSON_MASKS = 8

function boxesFrom(data: SamImageResult, maskCount: number): number[][] | undefined {
  const raw = data.boxes?.length
    ? data.boxes
    : (data.metadata ?? []).map((entry) => entry.box)
  const boxes = (raw ?? []).filter(
    (box): box is number[] => Array.isArray(box) && box.length >= 4,
  )
  if (boxes.length === 0 || boxes.length !== maskCount) return undefined
  return boxes
}

function maskUrlsFrom(data: SamImageResult): string[] {
  const urls: string[] = []
  for (const mask of data.masks ?? []) {
    if (mask.url) urls.push(mask.url)
  }
  if (urls.length === 0 && data.image?.url) urls.push(data.image.url)
  return urls
}

function requirePrompt(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed) {
    throw new Error('segmentImage requires an explicit prompt (Fal defaults to "wheel").')
  }
  return trimmed
}

export async function segmentImage(opts: {
  version: SamImageVersion
  imageUrl: string
  prompt: string
  points?: PointPrompt[]
  boxes?: BoxPrompt[]
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<SegmentResult> {
  const prompt = requirePrompt(opts.prompt)
  const modelId = SAM_IMAGE_MODELS[opts.version]
  const data = await subscribe<SamImageResult>(
    modelId,
    {
      image_url: opts.imageUrl,
      prompt,
      apply_mask: false,
      return_multiple_masks: true,
      max_masks: MAX_PERSON_MASKS,
      include_scores: true,
      include_boxes: true,
      ...(opts.points?.length ? { point_prompts: opts.points } : {}),
      ...(opts.boxes?.length ? { box_prompts: opts.boxes } : {}),
    },
    { signal: opts.signal, onQueueUpdate: opts.onQueueUpdate },
  )
  const maskUrls = maskUrlsFrom(data)
  const maskUrl = maskUrls[0]
  if (!maskUrl) throw new Error('SAM returned no mask.')
  return {
    maskUrl,
    maskUrls,
    boxes: boxesFrom(data, maskUrls.length),
    scores: data.scores,
    modelId,
  }
}

/** D13 default is 3.1; 3.0 is the cheaper fallback when 3.1 fails. */
export async function segmentImageWithFallback(opts: {
  version?: SamImageVersion
  imageUrl: string
  prompt: string
  points?: PointPrompt[]
  boxes?: BoxPrompt[]
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<SegmentResult> {
  const preferred = opts.version ?? '3.1'
  try {
    return await segmentImage({ ...opts, version: preferred })
  } catch (error) {
    if (preferred !== '3.1') throw error
    return segmentImage({ ...opts, version: '3.0' })
  }
}
