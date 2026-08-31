import { assertGlbMesh } from '../assetSniff'
import { subscribe, type FalSubscribeOpts } from './client'
import { falFileUrl, falLooksLikeGlb } from './files'
import { SAM_3D_BODY, SAM_3D_OBJECTS } from './models'

type FalFile = { url?: string; file_name?: string } | string

type LiftResult = {
  model_glb?: FalFile
  model_urls?: { glb?: FalFile }
  gaussian_splat?: FalFile
  individual_glbs?: FalFile[]
  metadata?: unknown
}

export type PersonLift = {
  glbUrl: string
  metadata?: unknown
}

function requireGlb(data: LiftResult, modelId: string): string {
  const url = falFileUrl(data.model_glb) ?? falFileUrl(data.model_urls?.glb)
  if (!url) throw new Error(`${modelId} returned no GLB.`)
  if (!falLooksLikeGlb(data.model_glb ?? data.model_urls?.glb)) {
    throw new Error(`${modelId} returned no GLB.`)
  }
  return url
}

function requireObjectGlb(data: LiftResult, modelId: string): string {
  const candidates: FalFile[] = []
  if (data.model_glb) candidates.push(data.model_glb)
  if (data.model_urls?.glb) candidates.push(data.model_urls.glb)
  for (const file of data.individual_glbs ?? []) candidates.push(file)
  for (const file of candidates) {
    if (falLooksLikeGlb(file)) return falFileUrl(file)!
  }
  throw new Error(`${modelId} returned no GLB mesh (only a Gaussian splat).`)
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
      export_meshes: false,
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
  maskUrl?: string
  prompt: string
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<string> {
  return (await liftPropDetailed(opts)).glbUrl
}

export async function liftPropDetailed(opts: {
  imageUrl: string
  maskUrl?: string
  prompt: string
  /** Official SAM 3 Objects flag — false was 422 / splat-only on some stills. */
  textured?: boolean
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<{ glbUrl: string; metadata?: unknown }> {
  const prompt = opts.prompt.trim()
  if (!prompt) throw new Error('liftProp requires an object noun (Fal defaults to "car").')
  const data = await subscribe<LiftResult>(
    SAM_3D_OBJECTS,
    {
      image_url: opts.imageUrl,
      ...(opts.maskUrl ? { mask_urls: [opts.maskUrl] } : {}),
      prompt,
      export_textured_glb: opts.textured ?? true,
    },
    { signal: opts.signal, onQueueUpdate: opts.onQueueUpdate },
  )
  return { glbUrl: requireObjectGlb(data, SAM_3D_OBJECTS), metadata: data.metadata }
}

export async function downloadFalBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(`Could not download the 3D model (${response.status}).`)
  }
  return response.arrayBuffer()
}

export async function downloadGlb(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const buffer = await downloadFalBytes(url, signal)
  assertGlbMesh(buffer)
  return buffer
}
