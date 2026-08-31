type FalFile = { url?: string; file_name?: string } | string

export function falFileUrl(file: FalFile | undefined): string | null {
  if (!file) return null
  if (typeof file === 'string') return file
  return file.url ?? null
}

export function falFileName(file: FalFile | undefined): string | undefined {
  if (!file || typeof file === 'string') return undefined
  return file.file_name
}

/** Fal File.content_type is often a PNG placeholder — use the URL / file_name. */
export function falLooksLikeGaussian(file: FalFile | undefined): boolean {
  const url = falFileUrl(file) ?? ''
  const name = falFileName(file) ?? ''
  return /\.(ply|splat|spz)(\?|$)/i.test(url) || /\.(ply|splat|spz)$/i.test(name)
}

export function falSplatFile(data: {
  model_mesh?: FalFile
  gaussian_splat?: FalFile
  splat?: FalFile
  ply?: FalFile
  model_urls?: { ply?: FalFile; splat?: FalFile }
}): FalFile | undefined {
  const candidates = [
    data.model_mesh,
    data.gaussian_splat,
    data.splat,
    data.ply,
    data.model_urls?.ply,
    data.model_urls?.splat,
  ]
  return candidates.find((file) => falLooksLikeGaussian(file)) ?? candidates.find((file) => falFileUrl(file))
}

export function falLooksLikeGlb(file: FalFile | undefined): boolean {
  if (!falFileUrl(file) || falLooksLikeGaussian(file)) return false
  const url = falFileUrl(file) ?? ''
  const name = falFileName(file) ?? ''
  if (/\.(fbx|obj|png|jpe?g|webp)(\?|$)/i.test(url) || /\.(fbx|obj|png|jpe?g|webp)$/i.test(name)) {
    return false
  }
  return true
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
  const candidates = [data.model_glb, data.model_urls?.glb, data.model_mesh]
  const mesh = candidates.find((file) => falLooksLikeGlb(file))
  const url = falFileUrl(mesh)
  if (url) return url
  if (candidates.some((file) => falLooksLikeGaussian(file))) {
    throw new Error(`${modelId} returned a Gaussian splat, not a GLB mesh.`)
  }
  const fallback = candidates.find((file) => falFileUrl(file))
  const fallbackUrl = falFileUrl(fallback) ?? ''
  const name = falFileName(fallback)
  const looksFbx =
    /\.fbx(\?|$)/i.test(fallbackUrl) || (name ? /\.fbx$/i.test(name) : false)
  if (looksFbx) throw new Error(`${modelId} returned FBX. Retry without quad topology.`)
  throw new Error(`${modelId} returned no GLB.`)
}
