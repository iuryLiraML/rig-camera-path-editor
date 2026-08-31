import { useAgentStore } from '../state/useAgentStore'
import { useEditorStore } from '../state/useEditorStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { useSceneStore } from '../state/useSceneStore'
import { getLiftAttachment, isVideoFile } from './fal/attachment'
import { configureFal, falUsable, uploadFile, uploadImage } from './fal/client'
import { downloadGlb, liftPersonDetailed, liftPropDetailed } from './fal/lift'
import {
  bumpFalJobTimeout,
  combineAbortSignals,
  finishFalJobAbort,
  isFalAbortError,
  startFalJobAbort,
  timeoutSignal,
} from './fal/jobAbort'
import { alignBodyToImage } from './fal/samAlign'
import { segmentImageWithFallback } from './fal/segment'
import { readFalAbortSignal, readFalSettings } from './fal/settings'
import {
  OBJECT_BLOCK_PROMPT,
  SCENE_BLOCK_CONCEPTS,
  makeFindRow,
  type FindRow,
} from './findObjects'
import { setHistorySuspended } from './history'
import { layoutBlockTransforms, parseSamPose, readFocalLength } from './sceneBlockPose'
import { importModelBuffer } from './sceneIO'

const SCENE_BLOCK_MAX_MASKS = 32
const MASK_CACHE_TIMEOUT_MS = 1_000

export type SceneBlockSession = {
  imageUrl: string
  file: File
  rows: FindRow[]
  /** Mask pixels in memory (not IDB — B5). Used to re-upload if the Fal URL 404s. */
  maskBytes: Record<string, ArrayBuffer>
}

let session: SceneBlockSession | null = import.meta.hot?.data?.sceneBlockSession ?? null

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.sceneBlockSession = session
  })
}

export function getSceneBlockSession(): SceneBlockSession | null {
  return session
}

export function clearSceneBlockSession() {
  session = null
}

function firstMeta(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw[0] ?? raw
  if (raw && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>
    if (Array.isArray(rec.people)) return rec.people[0] ?? raw
    if (Array.isArray(rec.objects)) return rec.objects[0] ?? raw
  }
  return raw
}

function objectPrompt(row: FindRow): string {
  const name = row.name.trim()
  if (row.kind === 'animal' && /^animal(?:\s+\d+)?$/i.test(name)) return 'dog'
  return /^object(?:\s+\d+)?$/i.test(name) ? 'object' : name.toLowerCase() || 'object'
}

function uniqueMaskRows(rows: FindRow[]): FindRow[] {
  const seen = new Set<string>()
  const out: FindRow[] = []
  for (const row of rows) {
    const key = row.maskUrl ?? row.id
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

function maskUrlGone(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /\b404\b|expired|no longer available/i.test(message)
}

async function cacheMaskBytes(rows: FindRow[], signal?: AbortSignal): Promise<Record<string, ArrayBuffer>> {
  const maskBytes: Record<string, ArrayBuffer> = {}
  await Promise.all(
    rows.map(async (row) => {
      const url = row.maskUrl
      if (!url) return
      try {
        const response = await fetch(url, {
          signal: combineAbortSignals(signal, timeoutSignal(MASK_CACHE_TIMEOUT_MS)),
        })
        if (!response.ok) return
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength === 0) return
        let liveUrl = url
        try {
          const file = new File([bytes], 'mask.png', { type: 'image/png' })
          liveUrl = await uploadFile(file, signal, { storage: true })
          row.maskUrl = liveUrl
        } catch {
          // Confirm still uses the SAM URL if re-host fails.
        }
        maskBytes[liveUrl] = bytes
      } catch {
        // Browser CORS often blocks Fal CDN — confirm still uses the original URL.
      }
    }),
  )
  return maskBytes
}

async function withLiveMask<T>(
  url: string,
  cached: ArrayBuffer | undefined,
  signal: AbortSignal | undefined,
  run: (maskUrl: string) => Promise<T>,
): Promise<T> {
  try {
    return await run(url)
  } catch (error) {
    if (!maskUrlGone(error) || !cached || cached.byteLength === 0) {
      if (maskUrlGone(error)) throw new Error('Run Block this scene again.')
      throw error
    }
    const file = new File([cached], 'mask.png', { type: 'image/png' })
    const next = await uploadFile(file, signal, { storage: true })
    return run(next)
  }
}

function closeSceneBlockPanel() {
  session = null
  useEnvironmentStore.getState().setFindOpen(false)
}

async function rowsFromSegment(
  kind: FindRow['kind'],
  imageUrl: string,
  prompt: string,
  signal: AbortSignal | undefined,
  label: string,
): Promise<FindRow[]> {
  try {
    const segmented = await segmentImageWithFallback({
      version: readFalSettings().samImageVersion,
      imageUrl,
      prompt,
      maxMasks: SCENE_BLOCK_MAX_MASKS,
      signal,
    })
    const count = segmented.maskUrls.length
    if (count === 0) return []
    return segmented.maskUrls.map((maskUrl, index) =>
      makeFindRow(kind, count > 1 ? `${label} ${index + 1}` : label, maskUrl),
    )
  } catch (error) {
    if (error instanceof Error && /no mask/i.test(error.message)) return []
    throw error
  }
}

export async function proposeSceneBlockFromFile(file: File): Promise<string> {
  if (isVideoFile(file)) return 'This tool needs a still. Attach a photo of the scene.'
  configureFal(useAgentStore.getState().falKey || readFalSettings().falKey)
  if (!falUsable()) return 'Add your Fal API key in Settings first.'
  const signal = readFalAbortSignal()
  const imageUrl = await uploadImage(file, signal, { storage: true })
  const settled = await Promise.allSettled(
    SCENE_BLOCK_CONCEPTS.map((concept) =>
      rowsFromSegment(concept.kind, imageUrl, concept.prompt, signal, concept.label),
    ),
  )
  let rows = uniqueMaskRows(
    settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])).filter((row) => row.maskUrl),
  )
  if (!rows.some((row) => row.kind !== 'person')) {
    const fallback = await rowsFromSegment('object', imageUrl, OBJECT_BLOCK_PROMPT, signal, 'Object')
    rows = uniqueMaskRows([...rows, ...fallback].filter((row) => row.maskUrl))
  }
  if (rows.length === 0) {
    session = null
    return 'No people or objects found in that still. Try a clearer photo.'
  }
  session = { imageUrl, file, rows, maskBytes: await cacheMaskBytes(rows, signal) }
  const env = useEnvironmentStore.getState()
  env.setSourceImage(file)
  env.setFindPlaceMode('scene')
  env.setFindOpen(true)
  return `Found ${rows.length} item${rows.length === 1 ? '' : 's'}. Review the list and confirm Place in scene. Do not pose_object yet.`
}

export async function proposeSceneBlockFromAttachment(): Promise<string> {
  const file = getLiftAttachment()
  if (!file) return 'Attach a photo in the chat, then ask again.'
  return proposeSceneBlockFromFile(file)
}

export async function runSceneBlockFromStill(file: File): Promise<void> {
  const scene = useSceneStore.getState()
  const liftId = scene.beginLift('Finding people and objects…', 'generate')
  try {
    const message = await proposeSceneBlockFromFile(file)
    scene.showNotice(message, 8000)
  } catch (error) {
    scene.showNotice(error instanceof Error ? error.message : 'Block this scene failed', 8000)
  } finally {
    scene.endLift(liftId)
  }
}

type LiftedBlock = {
  row: FindRow
  buffer: ArrayBuffer
  meta: unknown
  glbUrl: string
}

function applyBlockPose(objectId: string, row: FindRow, transform: ReturnType<typeof layoutBlockTransforms>[number]) {
  const rigKind = row.kind === 'person' ? 'sam-person' : 'none'
  useSceneStore.setState((s) => ({
    objects: s.objects.map((object) =>
      object.id === objectId ? { ...object, rigKind, transform, keepDenseMesh: true } : object,
    ),
  }))
}

function relayoutPlaced(lifted: LiftedBlock[], placedIds: string[]) {
  const transforms = layoutBlockTransforms(lifted.map((item) => parseSamPose(firstMeta(item.meta))))
  for (let i = 0; i < placedIds.length; i++) {
    const id = placedIds[i]
    const item = lifted[i]
    const transform = transforms[i]
    if (!id || !item || !transform) continue
    applyBlockPose(id, item.row, transform)
  }
}

async function instanceLifted(item: LiftedBlock): Promise<string | null> {
  const imported = await importModelBuffer(item.buffer, item.row.name, {
    announce: false,
    autoRemesh: false,
    normalize: false,
    keepDenseMesh: true,
  })
  if (!imported) return null
  const live = useSceneStore.getState().objects.find((object) => object.id === imported.objectId)
  if (live) live.root.userData.rigSkipNormalize = true
  const transform = layoutBlockTransforms([parseSamPose(firstMeta(item.meta))])[0]
  if (transform) applyBlockPose(imported.objectId, item.row, transform)
  return imported.objectId
}

function progressFromQueue(status: unknown): number | null {
  if (!status || typeof status !== 'object') return null
  const rec = status as Record<string, unknown>
  const value = rec.progress ?? rec.percentage
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < 0) return 0
  if (value <= 1) return value
  if (value <= 100) return value / 100
  return 1
}

function trackLiftProgress(liftId: string) {
  return (status: unknown) => {
    const fraction = progressFromQueue(status)
    if (fraction != null) useSceneStore.getState().setLiftProgress(liftId, fraction)
  }
}

function blockNotice(placed: number, failures: string[]): string {
  if (placed === 0) return failures[0] ?? 'Scene block finished but nothing could be imported.'
  const blocked = `Blocked ${placed} object${placed === 1 ? '' : 's'} into the scene`
  if (failures.length === 0) return blocked
  return `${blocked}. ${failures.length} failed.`
}

export async function commitSceneBlock(rows: FindRow[]): Promise<void> {
  const scene = useSceneStore.getState()
  const live = session
  if (!live?.imageUrl) {
    scene.showNotice('Run Block this scene again.', 8000)
    closeSceneBlockPanel()
    return
  }
  const confirmed = rows.filter((row) => Boolean(row.maskUrl))
  if (confirmed.length === 0) {
    scene.showNotice('Add a person or object first.')
    closeSceneBlockPanel()
    return
  }
  if (confirmed.length !== rows.length) {
    scene.showNotice('Run Block this scene again.', 8000)
    closeSceneBlockPanel()
    return
  }
  configureFal(useAgentStore.getState().falKey || readFalSettings().falKey)
  if (!falUsable()) {
    scene.showNotice('Add your Fal API key in Settings first.')
    closeSceneBlockPanel()
    return
  }
  const liftId = scene.beginLift('Blocking scene…', 'generate')
  const signal = combineAbortSignals(startFalJobAbort(liftId), readFalAbortSignal())
  closeSceneBlockPanel()
  setHistorySuspended(true)
  const lifted: LiftedBlock[] = []
  const placedIds: string[] = []
  const failures: string[] = []
  try {
    const people = confirmed.filter((row) => row.kind === 'person')
    const objects = confirmed.filter((row) => row.kind !== 'person')
    const queue = [...people, ...objects]
    for (let index = 0; index < queue.length; index++) {
      const row = queue[index]!
      bumpFalJobTimeout(liftId)
      scene.renameLift(liftId, `Lifting ${row.name}… (${index + 1} of ${queue.length})`)
      scene.setLiftProgress(liftId, null)
      try {
        const next = await withLiveMask(row.maskUrl!, live.maskBytes[row.maskUrl!], signal, (maskUrl) =>
          row.kind === 'person'
            ? liftPersonDetailed({
                imageUrl: live.imageUrl,
                maskUrl,
                signal,
                onQueueUpdate: trackLiftProgress(liftId),
              })
            : liftPropDetailed({
                imageUrl: live.imageUrl,
                maskUrl,
                prompt: objectPrompt(row),
                signal,
                onQueueUpdate: trackLiftProgress(liftId),
              }),
        )
        const buffer = await downloadGlb(next.glbUrl, signal)
        lifted.push({
          row,
          buffer,
          meta: next.metadata,
          glbUrl: next.glbUrl,
        })
      } catch (error) {
        if (isFalAbortError(error)) throw error
        console.error(error)
        failures.push(`${row.name}: ${error instanceof Error ? error.message : 'lift failed'}`)
      }
    }
    const person = lifted.find((item) => item.row.kind === 'person')
    const firstObject = lifted.find((item) => item.row.kind !== 'person')
    if (people.length === 1 && person) {
      bumpFalJobTimeout(liftId)
      scene.renameLift(liftId, firstObject ? 'Aligning person to objects…' : 'Aligning person…')
      scene.setLiftProgress(liftId, null)
      try {
        const aligned = await withLiveMask(
          people[0]!.maskUrl!,
          live.maskBytes[people[0]!.maskUrl!],
          signal,
          (bodyMaskUrl) =>
            alignBodyToImage({
              imageUrl: live.imageUrl,
              bodyMeshUrl: person.glbUrl,
              bodyMaskUrl,
              objectMeshUrl: firstObject?.glbUrl,
              focalLength: readFocalLength(person.meta),
              signal,
              onQueueUpdate: trackLiftProgress(liftId),
            }),
        )
        if (aligned.metadata) person.meta = aligned.metadata
      } catch (error) {
        if (isFalAbortError(error)) throw error
        console.error(error)
      }
    }
    scene.renameLift(liftId, 'Placing in scene…')
    scene.setLiftProgress(liftId, null)
    const placedItems: LiftedBlock[] = []
    for (const item of lifted) {
      const objectId = await instanceLifted(item)
      if (!objectId) {
        failures.push(`${item.row.name}: could not import`)
        continue
      }
      placedItems.push(item)
      placedIds.push(objectId)
    }
    relayoutPlaced(placedItems, placedIds)
    const first = placedIds[0]
    if (first) useEditorStore.getState().select(`obj:${first}`)
    scene.endLift(liftId)
    scene.showNotice(blockNotice(placedIds.length, failures), 8000)
  } catch (error) {
    scene.endLift(liftId)
    scene.showNotice(
      isFalAbortError(error)
        ? 'Scene block cancelled.'
        : error instanceof Error
          ? error.message
          : 'Scene block failed',
      8000,
    )
  } finally {
    finishFalJobAbort(liftId)
    setHistorySuspended(false)
  }
}
