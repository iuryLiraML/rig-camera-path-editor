/** Magenta is rare in room photos and rembg treats a uniform field as background. */
export const TRIPO_SPLAT_FRAME_FILL = '#ff00ff'
/** Keep the still off the canvas edge so rembg does not wipe a full-bleed room. */
export const TRIPO_SPLAT_FRAME_RATIO = 0.18

export function tripoSplatFrameRect(width: number, height: number): {
  width: number
  height: number
  pad: number
} {
  const pad = Math.max(24, Math.round(Math.max(width, height) * TRIPO_SPLAT_FRAME_RATIO))
  return { width: width + pad * 2, height: height + pad * 2, pad }
}

export function tripoSplatUserError(message: string): string {
  if (/no foreground subject/i.test(message) || /background removal/i.test(message)) {
    return (
      'TripoSplat strips the background and needs one subject. Room stills fail that check. ' +
      'Retry — the editor now frames the photo so the whole set stays in the splat.'
    )
  }
  return message
}

type Raster = CanvasImageSource & { width: number; height: number; close?: () => void }

/**
 * Pad the still so Fal's baked-in rembg keeps the entire frame (a room, not an
 * isolated product). Falls back to the original file if the browser cannot rasterize.
 */
export async function frameStillForTripoSplat(file: File): Promise<File> {
  const looksLikeImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(file.name)
  if (!looksLikeImage || file.size < 64) return file
  try {
    const bitmap = await Promise.race([
      rasterize(file),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Could not read the photo.')), 4000)
      }),
    ])
    const { width, height, pad } = tripoSplatFrameRect(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close?.()
      return file
    }
    ctx.fillStyle = TRIPO_SPLAT_FRAME_FILL
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, pad, pad, bitmap.width, bitmap.height)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '-framed.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

async function rasterize(file: File): Promise<Raster> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  return loadHtmlImage(file)
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
