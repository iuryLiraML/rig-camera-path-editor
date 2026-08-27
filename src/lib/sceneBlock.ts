import { useEditorStore } from '../state/useEditorStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { useSceneStore } from '../state/useSceneStore'
import { getLiftAttachment, isVideoFile } from './fal/attachment'
import { configureFal, falUsable, uploadFile, uploadImage } from './fal/client'
import { downloadGlb, liftPersonDetailed, liftPropDetailed } from './fal/lift'
import { combineAbortSignals, finishFalJobAbort, isFalAbortError, startFalJobAbort } from './fal/jobAbort'
import { alignBodyToImage } from './fal/samAlign'
import { segmentImageWithFallback } from './fal/segment'
import { readFalAbortSignal, readFalSettings } from './fal/settings'
import { generateEnvironmentFromPhoto } from './environmentJobs'
import { makeFindRow, type FindRow } from './findObjects'
import { setHistorySuspended } from './history'
import { layoutBlockTransforms, parseSamPose } from './sceneBlockPose'
import { importModelBuffer } from './sceneIO'

const OBJECT_DETECT_PROMPT = 'object. Exclude person, floor, wall, and ceiling.'

export type SceneBlockSession = {
  imageUrl: string
  file: File
  rows: FindRow[]
  /** Mask pixels in memory (not IDB — B5). Used to re-upload if the Fal URL 404s. */
  maskBytes: Record<string, ArrayBuffer>
}

let session: SceneBlockSession | null = null

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

function objectPrompt(name: string): string {
  return /^object(?:\s+\d+)?$/i.test(name.trim()) ? 'object' : name.trim() || 'object'
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
        const response = await fetch(url, { signal })
        if (!response.ok) return
        maskBytes[url] = await response.arrayBuffer()
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

async function rowsFromSegment(
  kind: FindRow['kind'],
  imageUrl: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<FindRow[]> {
  const segmented = await segmentImageWithFallback({
    version: readFalSettings().samImageVersion,
    imageUrl,
    prompt,
    signal,
  })
  const count = segmented.maskUrls.length
  if (count === 0) return []
  return segmented.maskUrls.map((maskUrl, index) =>
    makeFindRow(
      kind,
      count > 1 ? `${kind === 'person' ? 'Person' : 'Object'} ${index + 1}` : kind === 'person' ? 'Person' : 'Object',
      maskUrl,
    ),
  )
}

export async function proposeSceneBlockFromAttachment(): Promise<string> {
  const file = getLiftAttachment()
  if (!file) return 'Attach a photo in the chat, then ask again.'
  if (isVideoFile(file)) return 'This tool needs a still. Attach a photo of the scene.'
  if (!falUsable()) return 'Add your Fal API key in Settings first.'
  configureFal(readFalSettings().falKey)
  const signal = readFalAbortSignal()
  const imageUrl = await uploadImage(file, signal, { storage: true })
  const [peopleSettled, objectsSettled] = await Promise.allSettled([
    rowsFromSegment('person', imageUrl, 'person', signal),
    rowsFromSegment('object', imageUrl, OBJECT_DETECT_PROMPT, signal),
  ])
  const people = peopleSettled.status === 'fulfilled' ? peopleSettled.value : []
  const objects = objectsSettled.status === 'fulfilled' ? objectsSettled.value : []
  const rows = [...people, ...objects].filter((row) => row.maskUrl)
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

export async function commitSceneBlock(rows: FindRow[]): Promise<void> {
  const scene = useSceneStore.getState()
  const live = session
  if (!live?.imageUrl) {
    scene.showNotice('Run Block this scene again.')
    return
  }
  const confirmed = rows.filter((row) => Boolean(row.maskUrl))
  if (confirmed.length === 0) {
    scene.showNotice('Add a person or object first.')
    return
  }
  if (confirmed.length !== rows.length) {
    scene.showNotice('Run Block this scene again.')
    return
  }
  if (!falUsable()) {
    scene.showNotice('Add your Fal API key in Settings first.')
    return
  }
  configureFal(readFalSettings().falKey)
  const liftId = scene.beginLift('Blocking scene…', 'generate')
  const signal = combineAbortSignals(startFalJobAbort(liftId), readFalAbortSignal())
  setHistorySuspended(true)
  try {
    if (!useEnvironmentStore.getState().environmentId) {
      scene.renameLift(liftId, 'Generating environment…')
      const id = await generateEnvironmentFromPhoto(live.file, { signal })
      if (!id && !useEnvironmentStore.getState().environmentId) {
        throw new Error('Environment generate failed')
      }
    }
    const people = confirmed.filter((row) => row.kind === 'person')
    const objects = confirmed.filter((row) => row.kind === 'object')
    const lifted: {
      row: FindRow
      buffer: ArrayBuffer
      meta: unknown
      glbUrl: string
    }[] = []
    for (const row of people) {
      scene.renameLift(liftId, `Lifting ${row.name}…`)
      const next = await withLiveMask(row.maskUrl!, live.maskBytes[row.maskUrl!], signal, (maskUrl) =>
        liftPersonDetailed({ imageUrl: live.imageUrl, maskUrl, signal }),
      )
      lifted.push({
        row,
        buffer: await downloadGlb(next.glbUrl, signal),
        meta: next.metadata,
        glbUrl: next.glbUrl,
      })
    }
    for (const row of objects) {
      scene.renameLift(liftId, `Lifting ${row.name}…`)
      const next = await withLiveMask(row.maskUrl!, live.maskBytes[row.maskUrl!], signal, (maskUrl) =>
        liftPropDetailed({
          imageUrl: live.imageUrl,
          maskUrl,
          prompt: objectPrompt(row.name),
          signal,
        }),
      )
      lifted.push({
        row,
        buffer: await downloadGlb(next.glbUrl, signal),
        meta: next.metadata,
        glbUrl: next.glbUrl,
      })
    }
    if (people.length === 1 && lifted[0]) {
      const person = lifted[0]
      scene.renameLift(liftId, 'Aligning person…')
      try {
        const aligned = await withLiveMask(
          people[0].maskUrl!,
          live.maskBytes[people[0].maskUrl!],
          signal,
          (bodyMaskUrl) =>
            alignBodyToImage({
              imageUrl: live.imageUrl,
              bodyMeshUrl: person.glbUrl,
              bodyMaskUrl,
              signal,
            }),
        )
        if (aligned.metadata) person.meta = aligned.metadata
      } catch (error) {
        console.error(error)
      }
    }
    scene.renameLift(liftId, 'Placing in scene…')
    const transforms = layoutBlockTransforms(lifted.map((item) => parseSamPose(firstMeta(item.meta))))
    const placedIds: string[] = []
    for (let i = 0; i < lifted.length; i++) {
      const item = lifted[i]
      const imported = await importModelBuffer(item.buffer, item.row.name, {
        announce: false,
        autoRemesh: false,
      })
      if (!imported) continue
      const rigKind = item.row.kind === 'person' ? 'sam-person' : 'none'
      useSceneStore.setState((s) => ({
        objects: s.objects.map((object) =>
          object.id === imported.objectId ? { ...object, rigKind, transform: transforms[i] ?? object.transform } : object,
        ),
      }))
      placedIds.push(imported.objectId)
    }
    const first = placedIds[0]
    if (first) useEditorStore.getState().select(`obj:${first}`)
    useEnvironmentStore.getState().setFindOpen(false)
    session = null
    scene.endLift(liftId)
    scene.showNotice(
      placedIds.length === 0
        ? 'Scene block finished but nothing could be imported.'
        : `Blocked ${placedIds.length} object${placedIds.length === 1 ? '' : 's'} into the scene`,
    )
  } catch (error) {
    scene.endLift(liftId)
    scene.showNotice(
      isFalAbortError(error)
        ? 'Scene block cancelled.'
        : error instanceof Error
          ? error.message
          : 'Scene block failed',
    )
  } finally {
    finishFalJobAbort(liftId)
    setHistorySuspended(false)
  }
}
