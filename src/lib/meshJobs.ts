import { configureFal, falErrorMessage, falUsable, uploadFile, uploadImage } from './fal/client'
import { generateFromImage, generateFromText, stillForMeshy } from './fal/generate3d'
import { useAgentStore } from '../state/useAgentStore'
import { downloadGlb, liftPersonDetailed, liftPropDetailed } from './fal/lift'
import { alignBodyToImage } from './fal/samAlign'
import { reconstructViews, stillsForVggt } from './fal/vggt'
import { cancelFalJob, finishFalJobAbort, resetFalJobAborts, startFalJobAbort } from './fal/jobAbort'
import { remeshGlb } from './fal/remesh'
import { readFalSettings } from './fal/settings'
import { persistModelBuffer, fileFromBuffer, fileFromStoredBuffer } from './readModelFile'
import { idbGet, STORES } from './idb'
import {
  FAL_REMESH_MAX_BYTES,
  discardParkedMesh,
  isRemeshPlaceholder,
  keepHighMesh,
  modelFileDetails,
  parkMeshForRemesh,
  remeshTooLargeCopy,
  replaceImportedBuffer,
  restoreParkedMesh,
  setDenseRemeshEnqueue,
  yieldToBrowser,
} from './sceneIO'
import type { ModelSourceFormat } from './readModelFile'
import { parkUnplacedAsset } from './environmentJobs'
import { recordRemeshDuration } from './remeshEta'
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
  sourceTriangles?: number
  sourceFormat: ModelSourceFormat
  resolve: () => void
}

const remeshQueue: RemeshJob[] = []
let remeshPumping = false

function notice(error: unknown) {
  lastingGenerateNotice(error)
}

function lastingGenerateNotice(error: unknown, cancelled = 'Generation cancelled.') {
  const message = isAbortError(error)
    ? cancelled
    : error instanceof Error
      ? error.message
      : falErrorMessage(error, String(error))
  try {
    sessionStorage.setItem('rig:last-gen-error', message)
  } catch {
    /* private mode */
  }
  useSceneStore.getState().showNotice(message, 12_000)
}

function isAbortError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  const message = 'message' in error ? String(error.message) : ''
  return name === 'AbortError' || /abort/i.test(message)
}

function prepareFal() {
  configureFal(useAgentStore.getState().falKey || readFalSettings().falKey)
  if (!falUsable()) throw new Error('Add your Fal API key in Settings first.')
}

function trackGenerateProgress(liftId: string) {
  return (status: unknown) => {
    const fraction = remeshProgressFromQueueUpdate(status)
    if (fraction != null) useSceneStore.getState().setLiftProgress(liftId, fraction)
  }
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
  const { liftId, signal } = beginJob('generate', `${name} — Generating…`, 'generate')
  try {
    const url = await generateFromText({ prompt, signal, onQueueUpdate: trackGenerateProgress(liftId) })
    const buffer = await downloadGlb(url, signal)
    await parkUnplacedAsset({ buffer, name, rigKind: 'none' })
    useEditorStore.getState().setAddDrawerChip('assets')
  } catch (error) {
    lastingGenerateNotice(error)
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
  let still: File
  try {
    still = stillForMeshy(file)
  } catch (error) {
    lastingGenerateNotice(error)
    return
  }
  const name = file.name.replace(/\.[^.]+$/, '') || 'Generated'
  const { liftId, signal } = beginJob('generate', `${name} — Generating…`, 'generate')
  try {
    const imageUrl = await uploadImage(still, signal, { storage: true })
    const url = await generateFromImage({ imageUrl, signal, onQueueUpdate: trackGenerateProgress(liftId) })
    const buffer = await downloadGlb(url, signal)
    await parkUnplacedAsset({ buffer, name, rigKind: 'none' })
    useEditorStore.getState().setAddDrawerChip('assets')
  } catch (error) {
    lastingGenerateNotice(error)
  } finally {
    endJob('generate', liftId)
  }
}

function hopToTexturedUnplaced() {
  useEditorStore.getState().setViewMode('look')
  useEditorStore.getState().setAddDrawerChip('assets')
}

function stillStem(file: File, fallback: string) {
  return file.name.replace(/\.[^.]+$/, '') || fallback
}

async function runGenerateJob(
  name: string,
  work: (signal: AbortSignal, liftId: string) => Promise<void>,
  opts?: { verb?: string },
): Promise<void> {
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
  const verb = opts?.verb ?? 'Generating'
  const { liftId, signal } = beginJob('generate', `${name} — ${verb}…`, 'generate')
  try {
    await work(signal, liftId)
    hopToTexturedUnplaced()
  } catch (error) {
    lastingGenerateNotice(error)
  } finally {
    endJob('generate', liftId)
  }
}

/** SAM 3.0 Image to 3D Body — textured GLB, no 3.1 mask. */
export async function generateSamBody(file: File): Promise<void> {
  const name = stillStem(file, 'Person')
  await runGenerateJob(name, async (signal, liftId) => {
    const imageUrl = await uploadImage(file, signal, { storage: true })
    const lifted = await liftPersonDetailed({
      imageUrl,
      signal,
      onQueueUpdate: trackGenerateProgress(liftId),
    })
    const buffer = await downloadGlb(lifted.glbUrl, signal)
    await parkUnplacedAsset({ buffer, name, rigKind: 'sam-person', keepTexture: true })
  })
}

/** SAM 3.0 Image to 3D Object — noun + textured GLB. */
export async function generateSamObject(file: File, noun: string): Promise<void> {
  const prompt = noun.trim()
  if (!prompt) {
    useSceneStore.getState().showNotice('Type the object noun SAM should reconstruct.')
    return
  }
  const name = prompt.slice(0, 40)
  await runGenerateJob(name, async (signal, liftId) => {
    const imageUrl = await uploadImage(file, signal, { storage: true })
    const lifted = await liftPropDetailed({
      imageUrl,
      prompt,
      textured: true,
      signal,
      onQueueUpdate: trackGenerateProgress(liftId),
    })
    const buffer = await downloadGlb(lifted.glbUrl, signal)
    await parkUnplacedAsset({ buffer, name, rigKind: 'none', keepTexture: true })
  })
}

/** SAM 3.0 3D Alignment — body, optional object noun, then align. */
export async function generateSamAlign(file: File, objectNoun?: string): Promise<void> {
  const name = stillStem(file, 'Aligned')
  const prompt = objectNoun?.trim() ?? ''
  await runGenerateJob(name, async (signal, liftId) => {
    const imageUrl = await uploadImage(file, signal, { storage: true })
    const onQueueUpdate = trackGenerateProgress(liftId)
    const body = await liftPersonDetailed({ imageUrl, signal, onQueueUpdate })
    const object = prompt
      ? await liftPropDetailed({ imageUrl, prompt, textured: true, signal, onQueueUpdate })
      : null
    const aligned = await alignBodyToImage({
      imageUrl,
      bodyMeshUrl: body.glbUrl,
      objectMeshUrl: object?.glbUrl,
      signal,
      onQueueUpdate,
    })
    const glbUrl = aligned.glbUrl
    if (!glbUrl) throw new Error('SAM 3D Alignment returned no GLB.')
    const buffer = await downloadGlb(glbUrl, signal)
    await parkUnplacedAsset({ buffer, name, rigKind: 'sam-person', keepTexture: true })
    if (aligned.sceneGlbUrl) {
      const sceneBuffer = await downloadGlb(aligned.sceneGlbUrl, signal)
      await parkUnplacedAsset({
        buffer: sceneBuffer,
        name: prompt ? `${prompt} scene` : `${name} scene`,
        rigKind: 'none',
        keepTexture: true,
      })
    }
  })
}

/** VGGT-1B — overlapping stills to a coloured point cloud. Estimated cameras are discarded. */
export async function generatePointCloudFromViews(files: File[]): Promise<void> {
  let stills: File[]
  try {
    stills = stillsForVggt(files)
  } catch (error) {
    lastingGenerateNotice(error)
    return
  }
  const name = stillStem(stills[0]!, 'Point cloud')
  await runGenerateJob(
    name,
    async (signal, liftId) => {
      const imageUrls: string[] = []
      for (const still of stills) {
        imageUrls.push(await uploadImage(still, signal, { storage: true }))
      }
      const reconstructed = await reconstructViews({
        imageUrls,
        signal,
        onQueueUpdate: trackGenerateProgress(liftId),
      })
      const buffer = await downloadGlb(reconstructed.glbUrl, signal)
      await parkUnplacedAsset({
        buffer,
        name,
        rigKind: 'none',
        keepTexture: true,
        keepPoints: true,
      })
    },
    { verb: 'Reconstructing' },
  )
}

export type RemeshSceneObjectOpts = {
  sourceBuffer?: ArrayBuffer
  /** Auto-import placeholder: keep the source GLB available as a high-mesh fallback. */
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
    return
  }
  if (opts.sourceBuffer && opts.sourceBuffer.byteLength > FAL_REMESH_MAX_BYTES) {
    scene.showNotice(remeshTooLargeCopy(object.name))
    return
  }
  try {
    prepareFal()
  } catch (error) {
    notice(error)
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
      sourceTriangles: object.triangleCount,
      sourceFormat: object.sourceFormat ?? 'glb',
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
    const fileDetails = modelFileDetails(job.sourceFormat)
    const fileName = `${job.objectName}.${fileDetails.extension}`
    const file = job.buffer
      ? await fileFromBuffer(job.buffer, fileName, fileDetails.mime)
      : await fileFromStoredBuffer(
          job.bufferKey ?? job.objectId,
          fileName,
          fileDetails.mime,
        )
    if (!file) throw new Error('The original file is missing — re-import the model first.')
    if (file.size > FAL_REMESH_MAX_BYTES) throw new Error(remeshTooLargeCopy(job.objectName))
    const meshUrl = await uploadFile(file, job.signal, { storage: true })
    const url = await remeshGlb({
      meshUrl,
      sourceTriangles: job.sourceTriangles,
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
    try {
      const lift = useSceneStore.getState().pendingLifts.find((item) => item.id === job.liftId)
      recordRemeshDuration(Date.now() - (lift?.startedAt ?? Date.now()))
    } catch {
      /* duration memory must not undo a finished remesh */
    }
    useSceneStore.getState().showNotice(`Remeshed "${job.objectName}".`)
  } catch (error) {
    const live = useSceneStore.getState().objects.find((item) => item.id === job.objectId)
    const applied = live != null && !isRemeshPlaceholder(live.root)
    let message = isAbortError(error)
      ? 'Remesh cancelled.'
      : falErrorMessage(error, 'Remesh failed.')
    if (job.placeholder && !applied) {
      try {
        const fallback = await keepHighMesh(job.objectId, job.buffer)
        message = isAbortError(error)
          ? 'Remesh cancelled. Keeping high mesh.'
          : `${message}${/[.!?]$/.test(message) ? ' ' : '. '}Keeping high mesh.`
        if (!fallback.persisted) {
          message += ' Project storage is unavailable; this mesh is only kept for this session.'
        }
      } catch (restoreError) {
        console.error('Failed to keep high mesh after remesh stopped', restoreError)
        message = `${message} ${falErrorMessage(restoreError, 'Could not load the high mesh.')}`
      }
    } else if (!job.placeholder && !applied) {
      restoreParkedMesh(job.objectId)
    }
    if (!applied) revertIsolatedBufferKey(job.objectId, job.previousBufferKey)
    useSceneStore.getState().showNotice(message, 12_000)
  } finally {
    endJob(job.busyKey, job.liftId)
  }
}

setDenseRemeshEnqueue((objectId, buffer, _sourceFormat) => {
  void remeshSceneObject(objectId, { sourceBuffer: buffer, placeholder: true })
})

onSceneObjectRemoved((objectId) => {
  const lift = useSceneStore
    .getState()
    .pendingLifts.find((item) => item.kind === 'remesh' && item.objectId === objectId)
  if (lift) cancelMeshJob(lift.id)
})
