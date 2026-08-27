import { assertGaussianSplat } from '../assetSniff'
import { subscribe, type FalSubscribeOpts } from './client'
import { falFileName, falFileUrl } from './files'
import { downloadFalBytes } from './lift'
import { TRIPO_SPLAT, TRIPO_SPLAT_GAUSSIANS } from './models'
import type { EnvironmentFormat } from '../environment'

export async function generateTripoSplat(opts: {
  imageUrl: string
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<{ buffer: ArrayBuffer; fileName: string; format: EnvironmentFormat }> {
  const data = await subscribe<{
    model_mesh?: { url?: string; file_name?: string } | string
  }>(
    TRIPO_SPLAT,
    {
      image_url: opts.imageUrl,
      output_format: 'ply',
      num_gaussians: TRIPO_SPLAT_GAUSSIANS,
    },
    { signal: opts.signal, onQueueUpdate: opts.onQueueUpdate },
  )
  const url = falFileUrl(data.model_mesh)
  if (!url) throw new Error(`${TRIPO_SPLAT} returned no splat file.`)
  const fileName = falFileName(data.model_mesh) ?? 'environment.ply'
  const buffer = await downloadFalBytes(url, opts.signal)
  const format = assertGaussianSplat(buffer, fileName)
  return { buffer, fileName, format }
}
