import { subscribe, type FalSubscribeOpts } from './client'
import { requireModelGlb } from './files'
import { TRIPO_REMESH } from './models'

export async function remeshGlb(opts: {
  meshUrl: string
  signal?: AbortSignal
  onQueueUpdate?: FalSubscribeOpts['onQueueUpdate']
}): Promise<string> {
  const data = await subscribe<{
    model_mesh?: { url?: string; file_name?: string }
    model_glb?: { url?: string }
    model_urls?: { glb?: { url?: string } }
  }>(
    TRIPO_REMESH,
    {
      mesh_url: opts.meshUrl,
      quad: false,
      bake: false,
    },
    { signal: opts.signal, logs: true, onQueueUpdate: opts.onQueueUpdate },
  )
  return requireModelGlb(data, TRIPO_REMESH)
}
