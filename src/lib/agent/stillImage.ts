/** JPEG/PNG/WebP still sent on a user turn (base64, no data: prefix). */
export type AgentStill = { data: string; mediaType: string }

const JPEG_TYPE = 'image/jpeg'
const MAX_EDGE = 1024

/**
 * Chat photo wins. Viewport screenshot is only for turns with no attachment —
 * otherwise the model treats the torus knot on stage as "the attached photo".
 */
export function userTurnImage(opts: {
  chatPhoto?: AgentStill | null
  screenshot: boolean
  viewport?: string | null
}): AgentStill | undefined {
  if (opts.chatPhoto?.data) return opts.chatPhoto
  if (opts.screenshot && opts.viewport) {
    return { data: opts.viewport, mediaType: JPEG_TYPE }
  }
  return undefined
}

/** Screenshot Off still allows a chat photo on vision-capable models. */
export function visionForTurn(opts: {
  screenshotActive: boolean
  hasChatPhoto: boolean
  modelSupportsVision: boolean
}): boolean {
  if (!opts.modelSupportsVision) return false
  return opts.screenshotActive || opts.hasChatPhoto
}

/** Downscale a chat File to a JPEG the provider APIs accept. */
export async function encodeStillForAgent(
  file: File,
  maxEdge = MAX_EDGE,
): Promise<AgentStill | null> {
  try {
    const bitmap = await rasterize(file)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(2, Math.round(bitmap.width * scale))
    const height = Math.max(2, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      closeRaster(bitmap)
      return null
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    closeRaster(bitmap)
    const data = canvas.toDataURL(JPEG_TYPE, 0.85).split(',')[1]
    if (!data) return null
    return { data, mediaType: JPEG_TYPE }
  } catch {
    return null
  }
}

type Raster = CanvasImageSource & { width: number; height: number; close?: () => void }

async function rasterize(file: File): Promise<Raster> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file)
  }
  return loadHtmlImage(file)
}

function closeRaster(bitmap: Raster) {
  bitmap.close?.()
}

function loadHtmlImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read the photo.'))
    }
    img.src = url
  })
}
