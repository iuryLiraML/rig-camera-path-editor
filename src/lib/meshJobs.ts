import { configureFal, falUsable, uploadFile, uploadImage } from './fal/client'
import { generateFromImage, generateFromText } from './fal/generate3d'
import { downloadGlb } from './fal/lift'
import { cancelFalJob, finishFalJobAbort, resetFalJobAborts, startFalJobAbort } from './fal/jobAbort'
import { remeshGlb } from './fal/remesh'
import { readFalSettings } from './fal/settings'
import { persistModelBuffer, fileFromBuffer, fileFromStoredBuffer } from './readModelFile'
import { idbGet, STORES } from './idb'
import {
  FAL_REMESH_MAX_BYTES,
  discardParkedMesh,
  parkMeshForRemesh,
  remeshTooLargeCopy,
  replaceImportedBuffer,
  restoreParkedMesh,
  setDenseRemeshEnqueue,
  yieldToBrowser,
} from './sceneIO'
import { parkUnplacedAsset } from './environmentJobs'
import { useEditorStore } from '../state/useEditorStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { makeSceneId, objectGraveyard, onSceneObjectRemoved, useSceneStore } from '../state/useSceneStore'

const busy = new Set<string>()

type RemeshJob = {
  objectId: string
  buffer?: ArrayBuffer
  bufferKey?: string
  placeholder: boolean
  recordUndo: boolean
  objectName: string
  liftId: string
  signal: AbortSignal
  busyKey: string
  /** Set when this object shared an IndexedDB buffer with a duplicate. */
  previousBufferKey?: string
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
  const signal = startFalJobAbort(liftId)
  return { liftId, signal, scene }
}

function endJob(busyKey: string, liftId: string) {
  finishFalJobAbort(liftId)
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
  cancelFalJob(liftId)
}

export function resetMeshJobsForTests() {
  resetFalJobAborts()
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
    await parkUnplacedAsset({ buffer, name, rigKind: 'none' })
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
    const imageUrl = await uploadImage(file, signal, { storage: true })
    const url = await generateFromImage({ imageUrl, signal })
    const buffer = await downloadGlb(url, signal)
    await parkUnplacedAsset({ buffer, name, rigKind: 'none' })
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
  if (opts.sourceBuffer && opts.sourceBuffer.byteLength > FAL_REMESH_MAX_BYTES) {
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
  const previousBufferKey = await isolateSharedRemeshBuffer(objectId, object.bufferKey, opts.sourceBuffer)
  if (!opts.placeholder) parkMeshForRemesh(objectId)
  const { liftId, signal } = beginJob(busyKey, `${object.name} — Remeshing…`, 'remesh', objectId)
  return new Promise<void>((resolve) => {
    remeshQueue.push({
      objectId,
      buffer: opts.sourceBuffer,
      bufferKey: opts.sourceBuffer ? undefined : object.bufferKey ?? undefined,
      placeholder: Boolean(opts.placeholder),
      recordUndo,
      objectName: object.name,
      liftId,
      signal,
      busyKey,
      previousBufferKey,
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

async function isolateSharedRemeshBuffer(
  objectId: string,
  bufferKey: string | null,
  sourceBuffer?: ArrayBuffer,
): Promise<string | undefined> {
  if (!bufferKey) return undefined
  const sharedOnScene = useSceneStore
    .getState()
    .objects.some((item) => item.id !== objectId && item.bufferKey === bufferKey)
  const sharedOnShelf = useEnvironmentStore
    .getState()
    .unplacedAssets.some((asset) => asset.bufferKey === bufferKey)
  if (!sharedOnScene && !sharedOnShelf) return undefined
  const nextKey = objectId === bufferKey ? makeSceneId('buf') : objectId
  const source =
    sourceBuffer && sourceBuffer.byteLength > 0
      ? sourceBuffer
      : await idbGet<ArrayBuffer>(STORES.buffers, bufferKey)
  if (source && source.byteLength > 0) {
    try {
      await persistModelBuffer(nextKey, source.slice(0))
    } catch (error) {
      console.error('Failed to isolate remesh buffer', error)
    }
  }
  useSceneStore.setState((s) => ({
    objects: s.objects.map((item) => (item.id === objectId ? { ...item, bufferKey: nextKey } : item)),
  }))
  return bufferKey
}

function revertIsolatedBufferKey(objectId: string, previousBufferKey: string | undefined) {
  if (!previousBufferKey) return
  useSceneStore.setState((s) => ({
    objects: s.objects.map((item) =>
      item.id === objectId ? { ...item, bufferKey: previousBufferKey } : item,
    ),
  }))
  const buried = objectGraveyard.get(objectId)
  if (buried) buried.bufferKey = previousBufferKey
}

async function runRemeshJob(job: RemeshJob) {
  try {
    if (job.signal.aborted) throw new DOMException('The user aborted a request.', 'AbortError')
    await yieldToBrowser()
    const file = job.buffer
      ? await fileFromBuffer(job.buffer, `${job.objectName}.glb`, 'model/gltf-binary')
      : await fileFromStoredBuffer(job.bufferKey ?? job.objectId, `${job.objectName}.glb`, 'model/gltf-binary')
    if (!file) throw new Error('The original file is missing — re-import the model first.')
    if (file.size > FAL_REMESH_MAX_BYTES) throw new Error(remeshTooLargeCopy(job.objectName))
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
    if (!useSceneStore.getState().objects.some((item) => item.id === job.objectId)) {
      if (job.placeholder) discardParkedMesh(job.objectId)
      else restoreParkedMesh(job.objectId)
      revertIsolatedBufferKey(job.objectId, job.previousBufferKey)
      return
    }
    await replaceImportedBuffer(job.objectId, next, {
      recordUndo: job.recordUndo,
      previousBufferKey: job.previousBufferKey,
      previousBuffer: job.buffer,
    })
    discardParkedMesh(job.objectId)
    useSceneStore.getState().showNotice(`Remeshed "${job.objectName}".`)
  } catch (error) {
    if (job.placeholder) dropPlaceholder(job.objectId)
    else restoreParkedMesh(job.objectId)
    revertIsolatedBufferKey(job.objectId, job.previousBufferKey)
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

onSceneObjectRemoved((objectId) => {
  const lift = useSceneStore
    .getState()
    .pendingLifts.find((item) => item.kind === 'remesh' && item.objectId === objectId)
  if (lift) cancelMeshJob(lift.id)
})
