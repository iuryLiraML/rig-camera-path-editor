import { useAgentStore } from '../state/useAgentStore'
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

export type FindRowKind = 'person' | 'animal' | 'object'

export interface FindRow {
  id: string
  kind: FindRowKind
  name: string
  maskUrl?: string
}

export function makeFindRow(kind: FindRowKind, name: string, maskUrl?: string): FindRow {
  return { id: makeSceneId('find'), kind, name, maskUrl }
}

/**
 * SAM 3.1 is a concept segmenter (examples: person, wheel, car). Compound
 * "object. Exclude …" prompts return nothing, so Block this scene asks nouns.
 */
export const PERSON_DETECT_PROMPT = 'person'
export const ANIMAL_DETECT_PROMPT = 'dog, cat, animal. Exclude person, floor, wall, and ceiling.'
export const OBJECT_DETECT_PROMPT = 'object. Exclude person, floor, wall, and ceiling.'
export const OBJECT_BLOCK_PROMPT = 'object'

export type SceneBlockConcept = {
  kind: FindRowKind
  prompt: string
  label: string
}

export const SCENE_BLOCK_CONCEPTS: SceneBlockConcept[] = [
  { kind: 'person', prompt: PERSON_DETECT_PROMPT, label: 'Person' },
  { kind: 'animal', prompt: 'dog', label: 'Dog' },
  { kind: 'animal', prompt: 'cat', label: 'Cat' },
  { kind: 'object', prompt: 'table', label: 'Table' },
  { kind: 'object', prompt: 'desk', label: 'Desk' },
  { kind: 'object', prompt: 'chair', label: 'Chair' },
  { kind: 'object', prompt: 'plant', label: 'Plant' },
  { kind: 'object', prompt: 'furniture', label: 'Furniture' },
  { kind: 'object', prompt: 'sofa', label: 'Sofa' },
  { kind: 'object', prompt: 'lamp', label: 'Lamp' },
]

function asStillFile(image: Blob): File {
  return image instanceof File ? image : new File([image], 'environment.jpg', { type: image.type || 'image/jpeg' })
}

function conceptLabel(prompt: string, fallback: string): string {
  const word = prompt.trim().split(/[\s,]+/)[0]
  if (!word) return fallback
  return word.charAt(0).toUpperCase() + word.slice(1)
}

let findSeedRows: FindRow[] = []

export function setFindSeedRows(rows: FindRow[]) {
  findSeedRows = rows
}

export function takeFindSeedRows(): FindRow[] {
  const rows = findSeedRows
  findSeedRows = []
  return rows
}

export async function detectPeopleRows(image: Blob): Promise<FindRow[]> {
  configureFal(useAgentStore.getState().falKey || readFalSettings().falKey)
  if (!falUsable()) return [makeFindRow('person', 'Person')]
  const file = asStillFile(image)
  const imageUrl = await uploadImage(file, undefined, { storage: true })
  const segmented = await segmentImageWithFallback({
    version: readFalSettings().samImageVersion,
    imageUrl,
    prompt: PERSON_DETECT_PROMPT,
  })
  const count = Math.max(1, segmented.maskUrls.length)
  return Array.from({ length: count }, (_, index) =>
    makeFindRow('person', count > 1 ? `Person ${index + 1}` : 'Person', segmented.maskUrls[index]),
  )
}

export async function detectObjectRows(image: Blob, opts?: { prompt?: string }): Promise<FindRow[]> {
  configureFal(useAgentStore.getState().falKey || readFalSettings().falKey)
  if (!falUsable()) return []
  const file = asStillFile(image)
  const raw = opts?.prompt?.trim()
  const prompt = raw || OBJECT_DETECT_PROMPT
  const label = raw ? conceptLabel(raw, 'Object') : 'Object'
  try {
    const imageUrl = await uploadImage(file, undefined, { storage: true })
    const segmented = await segmentImageWithFallback({
      version: readFalSettings().samImageVersion,
      imageUrl,
      prompt,
    })
    const count = segmented.maskUrls.length
    if (count === 0) return []
    return Array.from({ length: count }, (_, index) =>
      makeFindRow('object', count > 1 ? `${label} ${index + 1}` : label, segmented.maskUrls[index]),
    )
  } catch {
    return []
  }
}

async function openFindFromStill(file: File, rows: FindRow[], emptyNotice: string) {
  const env = useEnvironmentStore.getState()
  env.setSourceImage(file)
  env.setFindPlaceMode('unplaced')
  setFindSeedRows(rows)
  env.setFindOpen(true)
  if (rows.length === 0) useSceneStore.getState().showNotice(emptyNotice, 8000)
}

export async function openFindPeopleFromStill(file: File): Promise<void> {
  const scene = useSceneStore.getState()
  const liftId = scene.beginLift('Finding people…', 'generate')
  try {
    await openFindFromStill(file, await detectPeopleRows(file), 'No people found. Add a Person row or try another still.')
  } catch (error) {
    scene.showNotice(error instanceof Error ? error.message : 'Find people failed', 8000)
  } finally {
    scene.endLift(liftId)
  }
}

export async function openFindObjectsFromStill(file: File, prompt?: string): Promise<void> {
  const scene = useSceneStore.getState()
  const liftId = scene.beginLift('Finding objects…', 'generate')
  try {
    await openFindFromStill(
      file,
      await detectObjectRows(file, { prompt }),
      'No objects found. Type a noun (chair, lamp) or add an Object row.',
    )
  } catch (error) {
    scene.showNotice(error instanceof Error ? error.message : 'Find objects failed', 8000)
  } finally {
    scene.endLift(liftId)
  }
}

export async function approveFindRows(rows: FindRow[], image: Blob | null) {
  const scene = useSceneStore.getState()
  if (rows.length === 0) {
    scene.showNotice('Add a person or object first.')
    return
  }
  configureFal(useAgentStore.getState().falKey || readFalSettings().falKey)
  if (!falUsable()) {
    scene.showNotice('Add your Fal API key in Settings first.')
    return
  }
  const file = image instanceof File ? image : image ? new File([image], 'environment.jpg', { type: image.type || 'image/jpeg' }) : null
  const liftId = scene.beginLift('Find objects — queueing…', 'generate')
  const signal = combineAbortSignals(startFalJobAbort(liftId), readFalAbortSignal())
  try {
    let imageUrl: string | null = null
    if (file && rows.some((row) => row.kind === 'person')) {
      imageUrl = await uploadImage(file, signal, { storage: true })
    }
    const people = rows.filter((row) => row.kind === 'person')
    const objects = rows.filter((row) => row.kind !== 'person')
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
