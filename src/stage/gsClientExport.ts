/**
 * Client MP4 export under ExportManifest (ARCHITECTURE-GS §5).
 * Sequence: quality pin → warmPath → setTime(t) → captureFrame → WebCodecs mux.
 */

import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import {
  avcCodecString,
  downloadBlob,
  frameTimingUs,
  isKeyframe,
  sleepMs,
} from '../lib/mp4Encode'
import type { ExportManifest } from './exportManifest'
import { StageHost } from './StageHost'

export type GsExportProgressPhase = 'pinning' | 'warming' | 'encoding' | 'finalizing'

export type GsExportProgress = {
  phase: GsExportProgressPhase
  /** 0..1 overall */
  fraction: number
  frameIndex?: number
  totalFrames?: number
}

export type GsClientExportOptions = {
  host: StageHost
  manifest: ExportManifest
  /** Shot length in seconds (not yet on ExportManifest). */
  durationS: number
  signal?: AbortSignal
  onProgress?: (progress: GsExportProgress) => void
  /** When true (default), trigger a browser download on success. */
  download?: boolean
  filename?: string
}

export class GsExportCancelledError extends Error {
  constructor() {
    super('GS export cancelled')
    this.name = 'GsExportCancelledError'
  }
}

export class GsExportUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GsExportUnsupportedError'
  }
}

/** Inclusive frame count for a duration at fps (≥ 2). */
export function totalExportFrames(durationS: number, fps: number): number {
  const safeDuration = Math.max(1 / 60, durationS)
  const safeFps = Math.max(1, fps)
  return Math.max(2, Math.round(safeDuration * safeFps))
}

/** Normalized timeline samples t ∈ [0, 1] for each encoded frame. */
export function exportFrameTimes(totalFrames: number): number[] {
  const n = Math.max(2, Math.floor(totalFrames))
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(i / (n - 1))
  }
  return out
}

/** Map encode index into overall progress (warm is ~10% of the bar). */
export function encodeProgressFraction(frameIndex: number, totalFrames: number): number {
  const n = Math.max(1, totalFrames)
  const encode = Math.min(1, Math.max(0, frameIndex / n))
  return 0.1 + encode * 0.85
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new GsExportCancelledError()
}

/**
 * Offline client export. Always locks quality to `manifest` for the duration
 * of the job, then restores the previous pin / view / time / canvas size.
 */
export async function exportGsClientVideo(options: GsClientExportOptions): Promise<Blob> {
  const {
    host,
    manifest,
    durationS,
    signal,
    onProgress,
    download = true,
    filename = 'rig-gs-export.mp4',
  } = options

  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new GsExportUnsupportedError('WebCodecs VideoEncoder is required for GS client export')
  }

  throwIfAborted(signal)

  const width = Math.max(16, Math.floor(manifest.width))
  const height = Math.max(16, Math.floor(manifest.height))
  const fps = Math.max(1, manifest.fps)
  const totalFrames = totalExportFrames(durationS, fps)
  const times = exportFrameTimes(totalFrames)

  const prevManifest = host.getQualityManifest()
  const prevTime = host.getTime()
  const prevView = host.getViewMode()

  onProgress?.({ phase: 'pinning', fraction: 0.02 })
  host.setQualityPin(manifest)
  host.setExportPixelSize({ width, height })
  host.setViewMode('camera')

  try {
    throwIfAborted(signal)
    onProgress?.({ phase: 'warming', fraction: 0.05 })
    await host.warmPath(manifest.pathSamples, manifest.warmTimeoutMs)

    throwIfAborted(signal)
    onProgress?.({
      phase: 'encoding',
      fraction: 0.1,
      frameIndex: 0,
      totalFrames,
    })

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height, frameRate: fps },
      fastStart: 'in-memory',
    })

    let encodeError: unknown = null
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        encodeError = e
      },
    })
    encoder.configure({
      codec: avcCodecString(width, height),
      width,
      height,
      bitrate: 10_000_000,
      framerate: fps,
    })

    try {
      for (let i = 0; i < totalFrames; i++) {
        throwIfAborted(signal)
        if (encodeError) throw encodeError

        host.setTime(times[i]!)
        const bitmap = await host.captureFrame()
        const timing = frameTimingUs(i, fps)
        const frame = new VideoFrame(bitmap, timing)
        bitmap.close()
        encoder.encode(frame, { keyFrame: isKeyframe(i, fps) })
        frame.close()

        if (i % 2 === 0) {
          onProgress?.({
            phase: 'encoding',
            fraction: encodeProgressFraction(i + 1, totalFrames),
            frameIndex: i + 1,
            totalFrames,
          })
          await sleepMs(0)
        }
        while (encoder.encodeQueueSize > 4) {
          throwIfAborted(signal)
          await sleepMs(4)
        }
      }

      throwIfAborted(signal)
      if (encodeError) throw encodeError

      onProgress?.({ phase: 'finalizing', fraction: 0.96 })
      await encoder.flush()
      muxer.finalize()
      const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' })
      onProgress?.({ phase: 'finalizing', fraction: 1 })
      if (download) downloadBlob(blob, filename)
      return blob
    } finally {
      try {
        if (encoder.state !== 'closed') encoder.close()
      } catch {
        /* already closed */
      }
    }
  } finally {
    host.setExportPixelSize(null)
    host.setQualityPin(prevManifest)
    host.setViewMode(prevView)
    host.setTime(prevTime)
  }
}

/** User-facing copy when warmPath fails — cloud fallback is not wired yet. */
export function warmPathTimeoutUserMessage(timeoutMs: number): string {
  return (
    `Path warm timed out after ${timeoutMs}ms — client export needs residency on this device. ` +
    'Cloud export fallback will use the same ExportManifest after AWS is configured.'
  )
}
