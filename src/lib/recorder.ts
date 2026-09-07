import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { useEditorStore, type ExportAspect, type ExportRes, type ViewMode } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'
import { cameraReady } from '../state/cameraPathLink'
import { usePathStore } from '../state/usePathStore'
import {
  avcCodecString,
  downloadBlob,
  evenExportDim,
  frameTimingUs,
  isKeyframe,
  sleepMs,
} from './mp4Encode'
import { renderBridge } from './renderBridge'
import { normalizeShotFps, shotFrameCount } from './timeView'
import { applyAssetDisplay, type AssetDisplayContext } from './assetDisplay'

/** output dimensions per aspect × resolution preset (all even, H.264-safe) */
export function exportDimensions(
  aspect: ExportAspect,
  res: ExportRes,
  customSize: [number, number],
): [number, number] {
  if (res === 'custom') {
    return [evenExportDim(customSize[0]), evenExportDim(customSize[1])]
  }
  const long = res === 1080 ? 1920 : 1280
  const short = res === 1080 ? 1080 : 720
  if (aspect === '16:9') return [long, short]
  if (aspect === '9:16') return [short, long]
  return [short, short]
}

let cancelled = false

export function isRecording() {
  return useEditorStore.getState().recording
}

export function cancelRecording() {
  cancelled = true
}

const sleep = sleepMs
const notice = (m: string) => useSceneStore.getState().showNotice(m)

/** selected passes, falling back to the active view mode */
function resolvePasses(): ViewMode[] {
  const editor = useEditorStore.getState()
  return editor.exportPasses.length > 0 ? [...editor.exportPasses] : [editor.viewMode]
}

function applyOfflineAssetDisplay(viewMode: ViewMode, context: AssetDisplayContext) {
  for (const object of useSceneStore.getState().objects) {
    applyAssetDisplay(object, viewMode, context)
  }
}

/**
 * Enters the deterministic offline-render environment (play mode, exact output
 * size via the canvas container, manual frame loop). Returns a restore fn.
 */
async function setupOffline(preserveT: boolean, kind: 'video' | 'still' = 'video') {
  const editor = useEditorStore.getState()
  const rig = useRigStore.getState()
  const path = usePathStore.getState()
  const prev = {
    selection: editor.selection,
    selectionIds: editor.selectionIds,
    selectedKeyframe: editor.selectedKeyframe,
    dummyBone: editor.dummyBone,
    viewMode: editor.viewMode,
    playMode: editor.playMode,
    tool: editor.tool,
    exportSize: editor.exportSize,
    t: rig.t,
    playing: rig.playing,
    pathSelection: {
      selectedAnchorRefs: path.selectedAnchorRefs,
      primaryAnchorRef: path.primaryAnchorRef,
      selectedAnchorId: path.selectedAnchorId,
      selectedAnchorIds: path.selectedAnchorIds,
      selectedHandle: path.selectedHandle,
    },
  }

  const restore = () => {
    renderBridge.setFrameloop?.('always')
    const ed = useEditorStore.getState()
    ed.setViewMode(prev.viewMode)
    applyOfflineAssetDisplay(prev.viewMode, 'live')
    usePathStore.setState(prev.pathSelection)
    // Selection actions intentionally clear anchors/keys. Restore the saved
    // session directly rather than replaying a new selection gesture.
    useEditorStore.setState({
      selection: prev.selection,
      selectionIds: prev.selectionIds,
      selectedKeyframe: prev.selectedKeyframe,
      dummyBone: prev.dummyBone,
      playMode: prev.playMode,
      tool: prev.tool,
      exportSize: prev.exportSize,
      recording: false,
      recordingKind: null,
      recordProgress: NaN,
    })
    useRigStore.setState({ t: prev.t, playing: prev.playing })
  }

  try {
    cancelled = false
    editor.setRecording(true, kind)
    editor.setRecordProgress(kind === 'still' ? NaN : 0)
    editor.select(null) // leave posing mode so object keyframes apply
    editor.setPlayMode(true)
    rig.setPlaying(false)
    if (!preserveT) rig.setT(0)
    applyOfflineAssetDisplay(editor.viewMode, 'export')

    // resize the canvas CONTAINER to the output size — R3F's resize observer
    // follows it (overriding state.setSize directly gets stomped by that observer)
    const [width, height] = exportDimensions(editor.exportAspect, editor.exportRes, editor.customSize)
    editor.setExportSize([width, height])
    await sleep(450) // let the UI hide, the canvas resize and the cinema camera take over
    renderBridge.setFrameloop?.('never')

    return { canvas: document.querySelector('canvas'), width, height, restore }
  } catch (error) {
    restore()
    throw error
  }
}

export type EncodedPass = { pass: ViewMode; blob: Blob }

/**
 * Offline H.264 encode of the selected passes. Caller owns download / packing.
 * Returns null when WebCodecs is missing, the canvas is gone, or encode fails.
 */
export async function encodePassVideos(): Promise<EncodedPass[] | null> {
  if (isRecording()) return null
  if (typeof VideoEncoder === 'undefined') return null
  const { advance } = renderBridge
  if (!advance || !renderBridge.setFrameloop) return null

  const passes = resolvePasses()
  const { canvas, width, height, restore } = await setupOffline(false)
  if (!canvas) {
    restore()
    return null
  }

  let encodeError: unknown = null
  const files: EncodedPass[] = []

  try {
    const copy = document.createElement('canvas')
    copy.width = width
    copy.height = height
    const ctx = copy.getContext('2d')
    if (!ctx) throw new Error('Cannot create export canvas')

    const level = avcCodecString(width, height)
    const duration = useRigStore.getState().duration
    const fps = normalizeShotFps(useRigStore.getState().fps)
    const totalFrames = Math.max(2, shotFrameCount(duration, fps))
    for (let p = 0; p < passes.length && !cancelled && !encodeError; p++) {
      const pass = passes[p]
      useEditorStore.getState().setViewMode(pass)
      applyOfflineAssetDisplay(pass, 'export')
      await sleep(80)

      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: 'avc', width, height, frameRate: fps },
        fastStart: 'in-memory',
      })
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => {
          encodeError = e
        },
      })
      try {
        encoder.configure({
          codec: level,
          width,
          height,
          bitrate: 10_000_000,
          framerate: fps,
        })

        for (let i = 0; i < totalFrames; i++) {
          if (cancelled || encodeError) break
          useRigStore.getState().setT(i / (totalFrames - 1))
          advance(performance.now())
          ctx.drawImage(canvas, 0, 0, width, height)
          const timing = frameTimingUs(i, fps)
          const frame = new VideoFrame(copy, timing)
          try {
            encoder.encode(frame, { keyFrame: isKeyframe(i, fps) })
          } finally {
            frame.close()
          }

          if (i % 3 === 0) {
            useEditorStore.getState().setRecordProgress((p + i / totalFrames) / passes.length)
            await sleep(0)
          }
          while (encoder.encodeQueueSize > 4 && !cancelled && !encodeError) await sleep(4)
        }

        if (!cancelled && !encodeError) {
          await encoder.flush()
          muxer.finalize()
          files.push({
            pass,
            blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }),
          })
        }
      } finally {
        try {
          if (encoder.state !== 'closed') encoder.close()
        } catch {
          /* already closed */
        }
      }
    }
  } catch (e) {
    encodeError = e
  } finally {
    restore()
  }

  if (encodeError) {
    console.error('MP4 export failed', encodeError)
    return null
  }
  if (cancelled) return null
  return files
}

/**
 * Exports the animation as MP4 (H.264) — one file per selected render pass
 * (clay/depth/outline/normals), all from the same deterministic shot-fps offline
 * render. Falls back to browser recording when WebCodecs is unavailable.
 */
function exportAllowed() {
  if (isRecording()) return false
  if (!cameraReady()) {
    notice('Add two path points or choose a Free camera in Compose')
    return false
  }
  if (useEditorStore.getState().exportPasses.length === 0) {
    notice('Select at least one export pass')
    return false
  }
  return true
}

export async function exportVideo() {
  if (!exportAllowed()) return
  if (typeof VideoEncoder === 'undefined') {
    await recordRealtime()
    return
  }
  const files = await encodePassVideos()
  if (!files) {
    if (cancelled) {
      notice('Export cancelled')
      return
    }
    notice('MP4 export failed — trying browser recording instead')
    await recordRealtime()
    return
  }
  for (const file of files) {
    downloadBlob(file.blob, `camera-animation_${file.pass}.mp4`)
  }
  notice(files.length > 1 ? `${files.length} passes exported (.mp4)` : 'Video exported (.mp4)')
}

/**
 * Exports the CURRENT playhead frame as PNG — one file per selected pass, at
 * the exact output resolution. Feed these to image models (restyle/ControlNet).
 */
export async function exportFrame() {
  if (!exportAllowed()) return
  const { advance } = renderBridge
  if (!advance || !renderBridge.setFrameloop) return

  const passes = resolvePasses()
  const rig = useRigStore.getState()
  const seconds = (rig.t * rig.duration).toFixed(1)
  const { canvas, width, height, restore } = await setupOffline(true, 'still')
  if (!canvas) {
    restore()
    return
  }

  try {
    const copy = document.createElement('canvas')
    copy.width = width
    copy.height = height
    const ctx = copy.getContext('2d')
    if (!ctx) throw new Error('Cannot create export canvas')
    for (let p = 0; p < passes.length && !cancelled; p++) {
      const pass = passes[p]
      useEditorStore.getState().setViewMode(pass)
      applyOfflineAssetDisplay(pass, 'export')
      await sleep(80)
      advance(performance.now())
      ctx.drawImage(canvas, 0, 0, width, height)
      const blob = await new Promise<Blob | null>((resolve) => copy.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Cannot encode PNG frame')
      if (cancelled) break
      downloadBlob(blob, `frame-${seconds}s_${pass}.png`)
      useEditorStore.getState().setRecordProgress((p + 1) / passes.length)
      await sleep(30)
    }
    notice(cancelled ? 'Export cancelled' : `Frame at ${seconds}s exported (.png)`)
  } catch (error) {
    console.error('Frame export failed', error)
    notice('Frame export failed — please try again')
  } finally {
    restore()
  }
}

/**
 * A shot's still, rendered the way the shot will look: cinema camera, export
 * aspect, no grid, path or gizmos. `captureThumbnail` copies the visible canvas
 * instead, so every Board card and Projects card was a screenshot of the editor
 * viewport — helpers, anchors and all — rather than the frame.
 */
export async function captureShotStill(maxWidth = 480): Promise<Blob | null> {
  const { advance } = renderBridge
  if (!advance || !renderBridge.setFrameloop || isRecording()) return null
  const { canvas, width, height, restore } = await setupOffline(true, 'still')
  if (!canvas) {
    restore()
    return null
  }
  try {
    if (cancelled) return null
    advance(performance.now())
    if (cancelled) return null
    const scale = Math.min(1, maxWidth / width)
    const copy = document.createElement('canvas')
    copy.width = Math.max(2, Math.round(width * scale))
    copy.height = Math.max(2, Math.round(height * scale))
    copy.getContext('2d')!.drawImage(canvas, 0, 0, copy.width, copy.height)
    return await new Promise<Blob | null>((resolve) => copy.toBlob(resolve, 'image/jpeg', 0.8))
  } finally {
    restore()
  }
}

/** Browser recording fallback, using the same capture context and selected passes. */
async function recordRealtime() {
  if (isRecording()) return
  const { advance } = renderBridge
  if (!advance || !renderBridge.setFrameloop) {
    notice('The viewport is not ready to export')
    return
  }
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'].find((m) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
  )
  if (!mime) {
    notice('Video recording is not supported in this browser')
    return
  }
  const passes = resolvePasses()
  const fps = normalizeShotFps(useRigStore.getState().fps)
  const frames = Math.max(2, shotFrameCount(useRigStore.getState().duration, fps))
  const extension = mime.startsWith('video/mp4') ? 'mp4' : 'webm'
  const { canvas, width, height, restore } = await setupOffline(false)
  const files: EncodedPass[] = []
  try {
    if (!canvas) throw new Error('No export canvas')
    // The WebGL backing store may be larger than its CSS size (Retina). A 2D
    // copy fixes output dimensions and gives browser recorders a stable source.
    const copy = document.createElement('canvas')
    copy.width = width
    copy.height = height
    const ctx = copy.getContext('2d')
    if (!ctx) throw new Error('Cannot create export canvas')
    for (let p = 0; p < passes.length && !cancelled; p++) {
      const pass = passes[p]
      useEditorStore.getState().setViewMode(pass)
      applyOfflineAssetDisplay(pass, 'export')
      await sleep(80)
      useRigStore.getState().setT(0)
      advance(performance.now())
      ctx.drawImage(canvas, 0, 0, width, height)
      const stream = copy.captureStream(fps)
      let recorder: MediaRecorder | undefined
      try {
        recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
        const chunks: Blob[] = []
        let recordingError: unknown
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
        recorder.onerror = (event) => { recordingError = event }
        const stopped = new Promise<void>((resolve) => { recorder!.onstop = () => resolve() })
        recorder.start()
        for (let frame = 0; frame < frames && !cancelled && !recordingError; frame++) {
          const started = performance.now()
          useRigStore.getState().setT(frame / (frames - 1))
          advance(started)
          ctx.drawImage(canvas, 0, 0, width, height)
          useEditorStore.getState().setRecordProgress((p + frame / frames) / passes.length)
          await sleep(Math.max(0, 1000 / fps - (performance.now() - started)))
        }
        if (recorder.state !== 'inactive') recorder.stop()
        let stopTimeout: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            stopped,
            new Promise<never>((_, reject) => {
              stopTimeout = setTimeout(() => reject(new Error('Browser recording did not finish')), 5000)
            }),
          ])
        } finally {
          clearTimeout(stopTimeout)
        }
        if (recordingError) throw recordingError
        if (!cancelled) {
          if (!chunks.length) throw new Error('The browser produced an empty recording')
          files.push({ pass, blob: new Blob(chunks, { type: mime.split(';')[0] }) })
        }
      } finally {
        if (recorder && recorder.state !== 'inactive') recorder.stop()
        stream.getTracks().forEach((track) => track.stop())
      }
    }
    if (cancelled) notice('Export cancelled')
    else {
      for (const file of files) downloadBlob(file.blob, `camera-animation_${file.pass}.${extension}`)
      notice(`${files.length} pass${files.length === 1 ? '' : 'es'} exported (.${extension})`)
    }
  } catch (error) {
    console.error('Browser video export failed', error)
    notice('Video export failed — please try again')
  } finally {
    restore()
  }
}
