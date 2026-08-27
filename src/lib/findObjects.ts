import { makeSceneId } from '../state/useSceneStore'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { useSceneStore } from '../state/useSceneStore'
import { configureFal, falUsable, uploadImage } from './fal/client'
import { generateFromText } from './fal/generate3d'
import { downloadGlb } from './fal/lift'
import { combineAbortSignals, finishFalJobAbort, startFalJobAbort } from './fal/jobAbort'
import { runMaskThenLift } from './fal/pipeline'
import { segmentImageWithFallback } from './fal/segment'
import { readFalAbortSignal, readFalSettings } from './fal/settings'
import { parkUnplacedAsset } from './environmentJobs'

export type FindRowKind = 'person' | 'object'

export interface FindRow {
  id: string
  kind: FindRowKind
  name: string
  maskUrl?: string
}

export function makeFindRow(kind: FindRowKind, name: string, maskUrl?: string): FindRow {
  return { id: makeSceneId('find'), kind, name, maskUrl }
}

export async function detectPeopleRows(image: Blob): Promise<FindRow[]> {
  if (!falUsable()) return [makeFindRow('person', 'Person')]
  configureFal(readFalSettings().falKey)
  const file = image instanceof File ? image : new File([image], 'environment.jpg', { type: image.type || 'image/jpeg' })
  const imageUrl = await uploadImage(file, undefined, { storage: true })
  const segmented = await segmentImageWithFallback({
    version: readFalSettings().samImageVersion,
    imageUrl,
    prompt: 'person',
  })
  const count = Math.max(1, segmented.maskUrls.length)
  return Array.from({ length: count }, (_, index) =>
    makeFindRow('person', count > 1 ? `Person ${index + 1}` : 'Person'),
  )
}

const OBJECT_DETECT_PROMPT = 'object. Exclude person, floor, wall, and ceiling.'

export async function detectObjectRows(image: Blob): Promise<FindRow[]> {
  if (!falUsable()) return []
  configureFal(readFalSettings().falKey)
  const file = image instanceof File ? image : new File([image], 'environment.jpg', { type: image.type || 'image/jpeg' })
  try {
    const imageUrl = await uploadImage(file, undefined, { storage: true })
    const segmented = await segmentImageWithFallback({
      version: readFalSettings().samImageVersion,
      imageUrl,
      prompt: OBJECT_DETECT_PROMPT,
    })
    const count = segmented.maskUrls.length
    if (count === 0) return []
    return Array.from({ length: count }, (_, index) =>
      makeFindRow('object', count > 1 ? `Object ${index + 1}` : 'Object'),
    )
  } catch {
    return []
  }
}

export async function approveFindRows(rows: FindRow[], image: Blob | null) {
  const scene = useSceneStore.getState()
  if (rows.length === 0) {
    scene.showNotice('Add a person or object first.')
    return
  }
  if (!falUsable()) {
    scene.showNotice('Add your Fal API key in Settings first.')
    return
  }
  configureFal(readFalSettings().falKey)
  const file = image instanceof File ? image : image ? new File([image], 'environment.jpg', { type: image.type || 'image/jpeg' }) : null
  const liftId = scene.beginLift('Find objects — queueing…', 'generate')
  const signal = combineAbortSignals(startFalJobAbort(liftId), readFalAbortSignal())
  try {
    let imageUrl: string | null = null
    if (file && rows.some((row) => row.kind === 'person')) {
      imageUrl = await uploadImage(file, signal, { storage: true })
    }
    const people = rows.filter((row) => row.kind === 'person')
    const objects = rows.filter((row) => row.kind === 'object')
    if (people.length && imageUrl) {
      const lifted = await runMaskThenLift({
        kind: 'person',
        prompt: 'person',
        imageUrl,
        version: readFalSettings().samImageVersion,
        signal,
      })
      for (let i = 0; i < people.length; i++) {
        const url = lifted.glbUrls[i] ?? lifted.glbUrls[0]
        if (!url) continue
        const buffer = await downloadGlb(url, signal)
        await parkUnplacedAsset({ buffer, name: people[i].name, rigKind: 'sam-person' })
      }
    }
    for (const row of objects) {
      const glbUrl = await generateFromText({ prompt: row.name, signal })
      const buffer = await downloadGlb(glbUrl, signal)
      await parkUnplacedAsset({ buffer, name: row.name, rigKind: 'none' })
    }
    scene.endLift(liftId)
    useEnvironmentStore.getState().setFindOpen(false)
    scene.showNotice('Queued into Unplaced')
  } catch (error) {
    scene.endLift(liftId)
    scene.showNotice(error instanceof Error ? error.message : 'Find objects failed')
  } finally {
    finishFalJobAbort(liftId)
  }
}
