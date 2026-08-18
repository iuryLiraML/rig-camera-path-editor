/**
 * Shared WebCodecs / mp4-muxer helpers used by the clay recorder and the GS
 * StageHost client export. Keep this free of editor/stage stores.
 */

/** H.264 Main-profile level from macroblock-aligned coded area (same table as clay). */
export function avcLevelFromCodedArea(width: number, height: number): string {
  const codedArea = Math.ceil(width / 16) * 16 * Math.ceil(height / 16) * 16
  if (codedArea > 2_228_224) return '33'
  if (codedArea > 921_600) return '2a'
  return '1f'
}

export function avcCodecString(width: number, height: number): string {
  return `avc1.4d00${avcLevelFromCodedArea(width, height)}`
}

/** Frame timestamp / duration in microseconds for VideoFrame + muxer. */
export function frameTimingUs(frameIndex: number, fps: number): {
  timestamp: number
  duration: number
} {
  const safeFps = Math.max(1, fps)
  return {
    timestamp: Math.round((frameIndex * 1e6) / safeFps),
    duration: Math.round(1e6 / safeFps),
  }
}

export function isKeyframe(frameIndex: number, fps: number, intervalSec = 2): boolean {
  const every = Math.max(1, Math.round(fps * intervalSec))
  return frameIndex % every === 0
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Even H.264-safe dimension in [16, 4096]. */
export function evenExportDim(v: number): number {
  return Math.max(16, Math.min(4096, Math.floor(v / 2) * 2))
}
