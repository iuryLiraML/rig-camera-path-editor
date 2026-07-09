import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { useEditorStore, type ExportAspect, type ExportRes, type ViewMode } from '../state/useEditorStore'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore } from '../state/useSceneStore'
import { renderBridge } from './renderBridge'

const FPS = 30

/** output dimensions per aspect × resolution preset (all even, H.264-safe) */
export function exportDimensions(
  aspect: ExportAspect,
  res: ExportRes,
  customSize: [number, number],
): [number, number] {
  if (res === 'custom') {
    const even = (v: number) => Math.max(16, Math.min(4096, Math.floor(v / 2) * 2))
    return [even(customSize[0]), even(customSize[1])]
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

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const notice = (m: string) => useSceneStore.getState().showNotice(m)

/** selected passes, falling back to the active view mode */
function resolvePasses(): ViewMode[] {
  const editor = useEditorStore.getState()
  return editor.exportPasses.length > 0 ? [...editor.exportPasses] : [editor.viewMode]
}

/**
 * Enters the deterministic offline-render environment (play mode, exact output
 * size via the canvas container, manual frame loop). Returns a restore fn.
 */
async function setupOffline(preserveT: boolean) {
  const editor = useEditorStore.getState()
  const rig = useRigStore.getState()
  const prev = { selection: editor.selection, viewMode: editor.viewMode, t: rig.t }

  cancelled = false
  editor.setRecording(true)
  editor.setRecordProgress(0)
  editor.select(null) // leave posing mode so object keyframes apply
  editor.setPlayMode(true)
  rig.setPlaying(false)
  if (!preserveT) rig.setT(0)

  // resize the canvas CONTAINER to the output size — R3F's resize observer
  // follows it (overriding state.setSize directly gets stomped by that observer)
  const [width, height] = exportDimensions(editor.exportAspect, editor.exportRes, editor.customSize)
  editor.setExportSize([width, height])
  await sleep(450) // let the UI hide, the canvas resize and the cinema camera take over
  renderBridge.setFrameloop?.('never')

  const restore = () => {
    useEditorStore.getState().setExportSize(null)
    renderBridge.setFrameloop?.('always')
    const r = useRigStore.getState()
    r.setPlaying(false)
    r.setT(preserveT ? prev.t : 0)
    const ed = useEditorStore.getState()
    ed.setViewMode(prev.viewMode)
    ed.setPlayMode(false)
    ed.setRecording(false)
    ed.setRecordProgress(NaN)
    ed.select(prev.selection)
  }

  return { canvas: document.querySelector('canvas'), width, height, restore }
}

/**
 * Exports the animation as MP4 (H.264) — one file per selected render pass
 * (clay/depth/outline/normals), all from the same deterministic 30 fps offline
 * render. Falls back to realtime WebM capture when WebCodecs is unavailable.
 */
export async function exportVideo() {
  if (isRecording()) return
  if (typeof VideoEncoder === 'undefined') {
    recordWebmRealtime()
    return
  }
  const { advance } = renderBridge
  if (!advance || !renderBridge.setFrameloop) return

  const passes = resolvePasses()
  const { canvas, width, height, restore } = await setupOffline(false)
  if (!canvas) {
    restore()
    return
  }

  const copy = document.createElement('canvas')
  copy.width = width
  copy.height = height
  const ctx = copy.getContext('2d')!

  // pick the AVC level from the coded area (macroblock-aligned)
  const codedArea = Math.ceil(width / 16) * 16 * Math.ceil(height / 16) * 16
  const level = codedArea > 2_228_224 ? '33' : codedArea > 921_600 ? '2a' : '1f'
  const duration = useRigStore.getState().duration
  const totalFrames = Math.max(2, Math.round(duration * FPS))

  let encodeError: unknown = null
  let exported = 0

  try {
    for (let p = 0; p < passes.length && !cancelled && !encodeError; p++) {
      const pass = passes[p]
      useEditorStore.getState().setViewMode(pass)
      await sleep(80) // let React commit the mode (override material / outline)

      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: 'avc', width, height, frameRate: FPS },
        fastStart: 'in-memory',
      })
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => {
          encodeError = e
        },
      })
      encoder.configure({
        codec: `avc1.4d00${level}`, // Main profile
        width,
        height,
        bitrate: 10_000_000,
        framerate: FPS,
      })

      try {
        for (let i = 0; i < totalFrames; i++) {
          if (cancelled || encodeError) break
          useRigStore.getState().setT(i / (totalFrames - 1))
          advance(performance.now())
          ctx.drawImage(canvas, 0, 0, width, height)
          const frame = new VideoFrame(copy, {
            timestamp: Math.round((i * 1e6) / FPS),
            duration: Math.round(1e6 / FPS),
          })
          encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 })
          frame.close()

          if (i % 3 === 0) {
            useEditorStore.getState().setRecordProgress((p + i / totalFrames) / passes.length)
            await sleep(0) // keep the tab responsive, let Esc through
          }
          while (encoder.encodeQueueSize > 4) await sleep(4)
        }

        if (!cancelled && !encodeError) {
          await encoder.flush()
          muxer.finalize()
          download(new Blob([muxer.target.buffer], { type: 'video/mp4' }), `camera-animation_${pass}.mp4`)
          exported++
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
    if (encodeError) {
      console.error('MP4 export failed', encodeError)
      notice('MP4 export failed — trying WebM instead')
      recordWebmRealtime()
    } else {
      notice(
        cancelled
          ? 'Export cancelled'
          : exported > 1
            ? `${exported} passes exported (.mp4)`
            : 'Video exported (.mp4)',
      )
    }
  }
}

/**
 * Exports the CURRENT playhead frame as PNG — one file per selected pass, at
 * the exact output resolution. Feed these to image models (restyle/ControlNet).
 */
export async function exportFrame() {
  if (isRecording()) return
  const { advance } = renderBridge
  if (!advance || !renderBridge.setFrameloop) return

  const passes = resolvePasses()
  const rig = useRigStore.getState()
  const seconds = (rig.t * rig.duration).toFixed(1)
  const { canvas, width, height, restore } = await setupOffline(true)
  if (!canvas) {
    restore()
    return
  }

  const copy = document.createElement('canvas')
  copy.width = width
  copy.height = height
  const ctx = copy.getContext('2d')!

  try {
    for (let p = 0; p < passes.length && !cancelled; p++) {
      const pass = passes[p]
      useEditorStore.getState().setViewMode(pass)
      await sleep(80)
      advance(performance.now())
      ctx.drawImage(canvas, 0, 0, width, height)
      const blob = await new Promise<Blob | null>((resolve) => copy.toBlob(resolve, 'image/png'))
      if (blob) download(blob, `frame-${seconds}s_${pass}.png`)
      useEditorStore.getState().setRecordProgress((p + 1) / passes.length)
      await sleep(30)
    }
  } finally {
    restore()
    notice(cancelled ? 'Export cancelled' : `Frame at ${seconds}s exported (.png)`)
  }
}

/** Realtime WebM capture — fallback for browsers without WebCodecs. */
function recordWebmRealtime() {
  if (isRecording()) return
  const canvas = document.querySelector('canvas')
  if (!canvas) return

  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
    typeof MediaRecorder !== 'undefined' ? MediaRecorder.isTypeSupported(m) : false,
  )
  if (!mime) {
    notice('Video recording is not supported in this browser')
    return
  }

  const prevLoop = useRigStore.getState().loop
  const editor = useEditorStore.getState()
  const rig = useRigStore.getState()

  cancelled = false
  editor.setRecording(true)
  editor.setRecordProgress(NaN)
  editor.setPlayMode(true)
  rig.setPlaying(false)
  rig.setLoop(false)
  rig.setT(0)

  const chunks: Blob[] = []
  const stream = canvas.captureStream(60)
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  let finished = false
  let unsubscribe = () => {}
  let cancelPoll: ReturnType<typeof setInterval> | undefined

  const finish = (save: boolean) => {
    if (finished) return
    finished = true
    clearInterval(cancelPoll)
    unsubscribe()
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop())
      if (save && chunks.length > 0) {
        download(new Blob(chunks, { type: 'video/webm' }), 'camera-animation.webm')
      }
      const r = useRigStore.getState()
      r.setPlaying(false)
      r.setLoop(prevLoop)
      r.setT(0)
      const e = useEditorStore.getState()
      e.setRecording(false)
      e.setPlayMode(false)
      notice(save ? 'Video exported (.webm)' : 'Export cancelled')
    }
    if (recorder.state !== 'inactive') recorder.stop()
    else recorder.onstop?.(new Event('stop') as never)
  }

  cancelPoll = setInterval(() => {
    if (cancelled) finish(false)
  }, 100)

  unsubscribe = useRigStore.subscribe((state, prev) => {
    if (prev.playing && !state.playing && !finished) finish(true)
  })

  setTimeout(() => {
    recorder.start(100)
    useRigStore.getState().setPlaying(true)
  }, 350)
}
