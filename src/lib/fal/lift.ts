import { subscribe, type FalSubscribeOpts } from './client'
import { SAM_3D_BODY, SAM_3D_OBJECTS } from './models'

type FalFile = { url?: string } | string

type LiftResult = {
  model_glb?: FalFile
  model_urls?: { glb?: FalFile }
  metadata?: unknown
}

export type PersonLift = {
  glbUrl: string
  metadata?: unknown
}

function fileUrl(file: FalFile | undefined): string | null {
  if (!file) return null
  if (typeof file === 'string') return file
  return file.url ?? null
}

function requireGlb(data: LiftResult, modelId: string): string {
  const url = fileUrl(data.model_glb) ?? fileUrl(data.model_urls?.glb)
  if (!url) throw new Error(`${modelId} returned no GLB.`)
  return url
}

export async function liftPersonDetailed(opts: {
  imageUrl: string
  /** Isolate one person with a SAM mask so a group photo becomes separate GLBs. */
  maskUrl?: string
  includeMhrParams?: boolean
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<PersonLift> {
  const data = await subscribe<LiftResult>(
    SAM_3D_BODY,
    {
      image_url: opts.imageUrl,
      ...(opts.maskUrl ? { mask_url: opts.maskUrl } : {}),
      export_meshes: true,
      include_3d_keypoints: false,
      include_mhr_params: opts.includeMhrParams ?? false,
    },
    { signal: opts.signal, onQueueUpdate: opts.onQueueUpdate },
  )
  return { glbUrl: requireGlb(data, SAM_3D_BODY), metadata: data.metadata }
}

export async function liftPerson(opts: {
  imageUrl: string
  /** Isolate one person with a SAM mask so a group photo becomes separate GLBs. */
  maskUrl?: string
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<string> {
  return (await liftPersonDetailed(opts)).glbUrl
}

export async function liftProp(opts: {
  imageUrl: string
  maskUrl: string
  prompt: string
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<string> {
  const prompt = opts.prompt.trim()
  if (!prompt) throw new Error('liftProp requires an object noun (Fal defaults to "car").')
  const data = await subscribe<LiftResult>(
    SAM_3D_OBJECTS,
    {
      image_url: opts.imageUrl,
      mask_urls: [opts.maskUrl],
      prompt,
    },
    { signal: opts.signal, onQueueUpdate: opts.onQueueUpdate },
  )
  return requireGlb(data, SAM_3D_OBJECTS)
}

export async function downloadGlb(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Could not download the lifted model (${response.status}).`)
  }
  return response.arrayBuffer()
}
