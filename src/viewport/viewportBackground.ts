import * as THREE from 'three'

/** Lighter charcoal at the top of the viewport so the vertical gradient reads. */
export const VIEWPORT_BG_DEFAULT_TOP = '#6b7385'
/** Near-black the gradient falls into at the bottom. */
export const VIEWPORT_BG_FLOOR = '#101218'
/** Shipped peach plate — migrate persisted settings that never left the default. */
export const VIEWPORT_BG_LEGACY_DEFAULT = '#efc8c4'
/** Previous Houdini slate default — migrate so existing editors pick up the gray. */
export const VIEWPORT_BG_SLATE_DEFAULT = '#2c3e4c'
/** Previous near-black default — migrate so the stronger gradient shows up. */
export const VIEWPORT_BG_CHARCOAL_DEFAULT = '#0f0f11'

const GRADIENT_HEIGHT = 256

export function isShippedViewportBgDefault(hex: unknown): hex is string {
  return (
    hex === VIEWPORT_BG_LEGACY_DEFAULT ||
    hex === VIEWPORT_BG_SLATE_DEFAULT ||
    hex === VIEWPORT_BG_CHARCOAL_DEFAULT
  )
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a)
  const cb = new THREE.Color(b)
  return `#${ca.lerp(cb, t).getHexString()}`
}

/** Bottom stop: the chosen top color pulled almost to the charcoal floor. */
export function viewportBgBottom(topHex: string): string {
  return mixHex(topHex, VIEWPORT_BG_FLOOR, 0.92)
}

export function viewportBgMid(topHex: string): string {
  return mixHex(topHex, viewportBgBottom(topHex), 0.42)
}

export function paintViewportGradient(
  ctx: CanvasRenderingContext2D,
  topHex: string,
  width: number,
  height: number,
) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, topHex)
  gradient.addColorStop(0.32, viewportBgMid(topHex))
  gradient.addColorStop(1, viewportBgBottom(topHex))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
}

export function createViewportGradientTexture(topHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = GRADIENT_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('viewport gradient: 2d context unavailable')
  paintViewportGradient(ctx, topHex, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.userData.bottomHex = viewportBgBottom(topHex)
  return texture
}

export function updateViewportGradientTexture(texture: THREE.CanvasTexture, topHex: string) {
  const canvas = texture.image as HTMLCanvasElement
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  paintViewportGradient(ctx, topHex, canvas.width, canvas.height)
  texture.userData.bottomHex = viewportBgBottom(topHex)
  texture.needsUpdate = true
}
