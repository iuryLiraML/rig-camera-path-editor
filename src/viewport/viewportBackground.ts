import * as THREE from 'three'

/** App chrome gray — new scenes start on the same plate as Projects. */
export const VIEWPORT_BG_DEFAULT_TOP = '#0f0f11'
/** Near-black the gradient falls into at the bottom. */
export const VIEWPORT_BG_FLOOR = '#070708'
/** Shipped peach plate — migrate persisted settings that never left the default. */
export const VIEWPORT_BG_LEGACY_DEFAULT = '#efc8c4'
/** Previous Houdini slate default — migrate so existing editors pick up the gray. */
export const VIEWPORT_BG_SLATE_DEFAULT = '#2c3e4c'

const GRADIENT_HEIGHT = 256

export function mixHex(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a)
  const cb = new THREE.Color(b)
  return `#${ca.lerp(cb, t).getHexString()}`
}

/** Bottom stop: the chosen top color pulled toward the charcoal floor. */
export function viewportBgBottom(topHex: string): string {
  return mixHex(topHex, VIEWPORT_BG_FLOOR, 0.78)
}

export function paintViewportGradient(
  ctx: CanvasRenderingContext2D,
  topHex: string,
  width: number,
  height: number,
) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, topHex)
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
