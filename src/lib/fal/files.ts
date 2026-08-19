type FalFile = { url?: string; file_name?: string } | string

export function falFileUrl(file: FalFile | undefined): string | null {
  if (!file) return null
  if (typeof file === 'string') return file
  return file.url ?? null
}

/**
 * Tripo returns `model_mesh`; Meshy returns `model_glb`. Quad remesh can emit FBX
 * — this editor only imports GLB.
 */
export function requireModelGlb(
  data: {
    model_glb?: FalFile
    model_mesh?: FalFile
    model_urls?: { glb?: FalFile }
  },
  modelId: string,
): string {
  const url =
    falFileUrl(data.model_glb) ?? falFileUrl(data.model_mesh) ?? falFileUrl(data.model_urls?.glb)
  if (!url) throw new Error(`${modelId} returned no GLB.`)
  const name = typeof data.model_mesh === 'object' ? data.model_mesh?.file_name : undefined
  const looksFbx = /\.fbx(\?|$)/i.test(url) || (name ? /\.fbx$/i.test(name) : false)
  if (looksFbx) throw new Error(`${modelId} returned FBX. Retry without quad topology.`)
  return url
}
