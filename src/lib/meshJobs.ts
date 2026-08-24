import { configureFal, falUsable, uploadFile, uploadImage } from './fal/client'
import { generateFromImage, generateFromText } from './fal/generate3d'
import { downloadGlb } from './fal/lift'
import { remeshGlb } from './fal/remesh'
import { readFalSettings } from './fal/settings'
import { idbGet, STORES } from './idb'
import {
  FAL_REMESH_MAX_BYTES,
  importModelBuffer,
  remeshTooLargeCopy,
  replaceImportedBuffer,
  setDenseRemeshEnqueue,
} from './sceneIO'
import { useEditorStore } from '../state/useEditorStore'
import { useSceneStore } from '../state/useSceneStore'

const busy = new Set<string>()
const controllers = new Map<string, AbortController>()

type RemeshJob = {
  objectId: string
  buffer: ArrayBuffer
  placeholder: boolean
  recordUndo: boolean
  objectName: string
  liftId: string
  signal: AbortSignal
  busyKey: string
  resolve: () => void
}

const remeshQueue: RemeshJob[] = []
let remeshPumping = false

function notice(error: unknown) {
  useSceneStore.getState().showNotice(error instanceof Error ? error.message : String(error))
}

function isAbortError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  const message = 'message' in error ? String(error.message) : ''
  return name === 'AbortError' || /abort/i.test(message)
}

function prepareFal() {
  const { falKey } = readFalSettings()
  configureFal(falKey)
  if (!falUsable()) throw new Error('Add your Fal API key in Settings first.')
}

function beginJob(busyKey: string, name: string, kind: 'generate' | 'remesh', objectId?: string) {
  const scene = useSceneStore.getState()
  const liftId = scene.beginLift(name, kind, objectId)
  busy.add(busyKey)
  const controller = new AbortController()
  controllers.set(liftId, controller)
  return { liftId, signal: controller.signal, scene }
}

function endJob(busyKey: string, liftId: string) {
  controllers.delete(liftId)
  busy.delete(busyKey)
  useSceneStore.getState().endLift(liftId)
}

function dropPlaceholder(objectId: string) {
  const scene = useSceneStore.getState()
  if (!scene.objects.some((item) => item.id === objectId)) return
  scene.removeObject(objectId)
  const editor = useEditorStore.getState()
  if (editor.selection === `obj:${objectId}`) editor.select(null)
}

export function cancelMeshJob(liftId: string) {
  controllers.get(liftId)?.abort()
}

export function resetMeshJobsForTests() {
  for (const controller of controllers.values()) controller.abort()
  controllers.clear()
  busy.clear()
  const pending = remeshQueue.splice(0)
  remeshPumping = false
  for (const job of pending) job.resolve()
}

/** Real Fal % from queue payload/logs. Null when Fal only reports IN_QUEUE / IN_PROGRESS. */
export function remeshProgressFromQueueUpdate(status: unknown): number | null {
  if (!status || typeof status !== 'object') return null
  const rec = status as Record<string, unknown>
  const fromField = fractionFromUnknown(rec.progress) ?? fractionFromUnknown(rec.percentage)
  if (fromField != null) return fromField
  if (!Array.isArray(rec.logs)) return null
  let found: number | null = null
  for (const log of rec.logs) {
    const message =
      typeof log === 'string'
        ? log
        : log && typeof log === 'object' && 'message' in log
          ? String((log as { message: unknown }).message)
          : ''
    const parsed = fractionFromLog(message)
    if (parsed != null) found = parsed
  }
  return found
}

function fractionFromUnknown(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < 0) return 0
  if (value <= 1) return value
  if (value <= 100) return value / 100
  return 1
}

function fractionFromLog(message: string): number | null {
  const pct = message.match(/(\d+(?:\.\d+)?)\s*%/)
  if (pct) return fractionFromUnknown(Number(pct[1]))
  const labeled = message.match(/progress\D+(\d+(?:\.\d+)?)/i)
  if (labeled) return fractionFromUnknown(Number(labeled[1]))
  return null
}

export async function generateObjectFromText(prompt: string): Promise<void> {
  try {
    prepareFal()
  } catch (error) {
    notice(error)
    return
  }
  if (busy.has('generate')) {
    useSceneStore.getState().showNotice('A generate job is already running.')
    return
  }
  const name = prompt.trim().slice(0, 40) || 'Generated'
  const { liftId, signal, scene } = beginJob('generate', `${name} — Generating…`, 'generate')
  try {
    const url = await generateFromText({ prompt, signal })
    const buffer = await downloadGlb(url, signal)
    const imported = await importModelBuffer(buffer, name)
    if (!imported) scene.showNotice('Generated a model but it could not be imported.')
  } catch (error) {
    scene.showNotice(isAbortError(error) ? 'Generation cancelled.' : error instanceof Error ? error.message : String(error))
  } finally {
    endJob('generate', liftId)
  }
}

export async function generateObjectFromImage(file: File): Promise<void> {
  try {
    prepareFal()
  } catch (error) {
    notice(error)
    return
  }
  if (busy.has('generate')) {
    useSceneStore.getState().showNotice('A generate job is already running.')
    return
  }
  const name = file.name.replace(/\.[^.]+$/, '') || 'Generated'
  const { liftId, signal, scene } = beginJob('generate', `${name} — Generating…`, 'generate')
  try {
    const imageUrl = await uploadImage(file, signal)
    const url = await generateFromImage({ imageUrl, signal })
    const buffer = await downloadGlb(url, signal)
    const imported = await importModelBuffer(buffer, name)
    if (!imported) scene.showNotice('Generated a model but it could not be imported.')
  } catch (error) {
    scene.showNotice(isAbortError(error) ? 'Generation cancelled.' : error instanceof Error ? error.message : String(error))
  } finally {
    endJob('generate', liftId)
  }
}

export type RemeshSceneObjectOpts = {
  sourceBuffer?: ArrayBuffer
  /** Auto-import placeholder: drop the object if remesh is cancelled or fails. */
  placeholder?: boolean
  recordUndo?: boolean
}

export async function remeshSceneObject(objectId: string, opts: RemeshSceneObjectOpts = {}): Promise<void> {
  const busyKey = `remesh:${objectId}`
  if (busy.has(busyKey)) {
    useSceneStore.getState().showNotice('That object is already remeshing.')
    return
  }
  const scene = useSceneStore.getState()
  const object = scene.objects.find((item) => item.id === objectId)
  if (!object?.bufferKey) {
    scene.showNotice('Only imported models can be remeshed.')
    if (opts.placeholder) dropPlaceholder(objectId)
    return
  }
  const buffer = opts.sourceBuffer ?? (await idbGet<ArrayBuffer>(STORES.buffers, object.bufferKey))
  if (!buffer) {
    scene.showNotice('The original file is missing — re-import the model first.')
    if (opts.placeholder) dropPlaceholder(objectId)
    return
  }
  if (buffer.byteLength > FAL_REMESH_MAX_BYTES) {
    scene.showNotice(remeshTooLargeCopy(object.name))
    if (opts.placeholder) dropPlaceholder(objectId)
    return
  }
  try {
    prepareFal()
  } catch (error) {
    notice(error)
    if (opts.placeholder) dropPlaceholder(objectId)
    return
  }
  const recordUndo = opts.placeholder ? false : (opts.recordUndo ?? true)
  const { liftId, signal } = beginJob(busyKey, `${object.name} — Remeshing…`, 'remesh', objectId)
  return new Promise<void>((resolve) => {
    remeshQueue.push({
      objectId,
      buffer,
      placeholder: Boolean(opts.placeholder),
      recordUndo,
      objectName: object.name,
      liftId,
      signal,
      busyKey,
      resolve,
    })
    void pumpRemeshQueue()
  })
}

async function pumpRemeshQueue() {
  if (remeshPumping) return
  remeshPumping = true
  try {
    while (remeshQueue.length > 0) {
      const job = remeshQueue.shift()
      if (!job) continue
      try {
        await runRemeshJob(job)
      } finally {
        job.resolve()
      }
    }
  } finally {
    remeshPumping = false
  }
}

async function runRemeshJob(job: RemeshJob) {
  try {
    if (job.signal.aborted) throw new DOMException('The user aborted a request.', 'AbortError')
    const file = new File([job.buffer], `${job.objectName}.glb`, { type: 'model/gltf-binary' })
    const meshUrl = await uploadFile(file, job.signal)
    const url = await remeshGlb({
      meshUrl,
      signal: job.signal,
      onQueueUpdate: (status) => {
        const fraction = remeshProgressFromQueueUpdate(status)
        if (fraction != null) useSceneStore.getState().setLiftProgress(job.liftId, fraction)
      },
    })
    const next = await downloadGlb(url, job.signal)
    if (!useSceneStore.getState().objects.some((item) => item.id === job.objectId)) return
    await replaceImportedBuffer(job.objectId, next, { recordUndo: job.recordUndo })
    useSceneStore.getState().showNotice(`Remeshed "${job.objectName}".`)
  } catch (error) {
    if (job.placeholder) dropPlaceholder(job.objectId)
    useSceneStore
      .getState()
      .showNotice(isAbortError(error) ? 'Remesh cancelled.' : error instanceof Error ? error.message : String(error))
  } finally {
    endJob(job.busyKey, job.liftId)
  }
}

setDenseRemeshEnqueue((objectId, buffer) => {
  void remeshSceneObject(objectId, { sourceBuffer: buffer, placeholder: true })
})
