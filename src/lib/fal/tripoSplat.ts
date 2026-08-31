import { assertGaussianSplat } from '../assetSniff'
import { subscribe, type FalSubscribeOpts } from './client'
import { falFileName, falFileUrl, falSplatFile } from './files'
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
    gaussian_splat?: { url?: string; file_name?: string } | string
    splat?: { url?: string; file_name?: string } | string
    ply?: { url?: string; file_name?: string } | string
    model_urls?: { ply?: { url?: string; file_name?: string }; splat?: { url?: string; file_name?: string } }
  }>(
    TRIPO_SPLAT,
    {
      image_url: opts.imageUrl,
      output_format: 'ply',
      num_gaussians: TRIPO_SPLAT_GAUSSIANS,
    },
    { signal: opts.signal, logs: true, onQueueUpdate: opts.onQueueUpdate },
  )
  const file = falSplatFile(data)
  const url = falFileUrl(file)
  if (!url) {
    const keys = data && typeof data === 'object' ? Object.keys(data).join(', ') : 'empty'
    throw new Error(`${TRIPO_SPLAT} returned no splat file (${keys}).`)
  }
  const fileName = falFileName(file) ?? 'environment.ply'
  const buffer = await downloadFalBytes(url, opts.signal)
  const format = assertGaussianSplat(buffer, fileName)
  return { buffer, fileName, format }
}
