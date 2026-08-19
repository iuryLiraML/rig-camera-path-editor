import { getLiftAttachment, isVideoFile, peekLastLifts, recordLifts } from './attachment'
import { serverHasKey } from '../agent/serverKeys'
import { configureFal, uploadImage } from './client'
import { downloadGlb, liftPerson, liftProp } from './lift'
import { layoutPeoplePositions, personObjectName } from './peopleLayout'
import { segmentImageWithFallback } from './segment'
import type { SamImageVersion } from './models'
import { readFalAbortSignal } from './settings'

export type LiftKind = 'person' | 'prop'

export async function runMaskThenLift(opts: {
  kind: LiftKind
  prompt: string
  imageUrl: string
  version?: SamImageVersion
  signal?: AbortSignal
}): Promise<{
  glbUrls: string[]
  maskUrl: string
  maskCount: number
  modelId: string
  boxes?: number[][]
}> {
  const segmented = await segmentImageWithFallback({
    version: opts.version,
    imageUrl: opts.imageUrl,
    prompt: opts.prompt,
    signal: opts.signal,
  })
  const maskCount = segmented.maskUrls.length
  if (opts.kind === 'prop') {
    const glbUrl = await liftProp({
      imageUrl: opts.imageUrl,
      maskUrl: segmented.maskUrl,
      prompt: opts.prompt,
      signal: opts.signal,
    })
    return {
      glbUrls: [glbUrl],
      maskUrl: segmented.maskUrl,
      maskCount,
      modelId: segmented.modelId,
      boxes: segmented.boxes,
    }
  }

  const glbUrls: string[] = []
  for (const maskUrl of segmented.maskUrls) {
    glbUrls.push(
      await liftPerson({
        imageUrl: opts.imageUrl,
        maskUrl,
        signal: opts.signal,
      }),
    )
  }
  return {
    glbUrls,
    maskUrl: segmented.maskUrl,
    maskCount,
    modelId: segmented.modelId,
    boxes: segmented.boxes,
  }
}

export async function liftAttachedStill(opts: {
  kind: LiftKind
  prompt: string
  falKey: string
  version?: SamImageVersion
  signal?: AbortSignal
  importBuffer: (
    buffer: ArrayBuffer,
    name: string,
  ) => Promise<{ objectId: string; objectName: string } | null>
  beginLift: (name: string, kind: LiftKind, objectId?: string) => string
  endLift: (id: string) => void
  replacePrevious?: (objectId: string) => void
  placeObject?: (objectId: string, position: [number, number, number]) => void
}): Promise<string> {
  const key = opts.falKey.trim()
  if (!key && !serverHasKey('fal')) return 'Add your Fal API key in Settings first.'
  const file = getLiftAttachment()
  if (!file) return 'Attach a photo in the chat, then ask again.'
  if (isVideoFile(file)) {
    return 'This tool lifts a still. Attach a photo to lift a person.'
  }

  const prompt = opts.prompt.trim()
  if (!prompt) {
    return opts.kind === 'prop'
      ? 'generate_prop needs a prompt noun (helmet, bottle, chair).'
      : 'block_people_from_image needs a subject prompt.'
  }

  configureFal(key)
  const signal = opts.signal ?? readFalAbortSignal()
  const fileStem = file.name.replace(/\.[^.]+$/, '') || (opts.kind === 'person' ? 'Person' : 'Prop')
  const liftLabel = opts.kind === 'person' ? 'People — Lifting…' : `${fileStem} — Lifting…`
  const liftId = opts.beginLift(liftLabel, opts.kind)
  try {
    const imageUrl = await uploadImage(file)
    const { glbUrls, boxes } = await runMaskThenLift({
      kind: opts.kind,
      prompt,
      imageUrl,
      version: opts.version,
      signal,
    })
    const imported: { objectId: string; objectName: string }[] = []
    const slots = opts.kind === 'person' ? layoutPeoplePositions(glbUrls.length, boxes) : [[0, 0, 0] as [number, number, number]]
    for (let i = 0; i < glbUrls.length; i++) {
      const glbUrl = glbUrls[i]
      if (!glbUrl) continue
      const buffer = await downloadGlb(glbUrl)
      const objectName =
        opts.kind === 'person' ? personObjectName(i, glbUrls.length) : fileStem
      const next = await opts.importBuffer(buffer, objectName)
      if (!next) continue
      const slot = slots[i] ?? [0, 0, 0]
      if (slot[0] !== 0 || slot[1] !== 0 || slot[2] !== 0) {
        opts.placeObject?.(next.objectId, slot)
      }
      imported.push(next)
    }
    opts.endLift(liftId)
    if (imported.length === 0) return 'The lift finished but the GLB could not be imported.'

    const importedIds = new Set(imported.map((item) => item.objectId))
    for (const previousId of peekLastLifts(opts.kind)) {
      if (!importedIds.has(previousId)) opts.replacePrevious?.(previousId)
    }
    recordLifts(
      opts.kind,
      imported.map((item) => item.objectId),
    )

    const ids = imported.map((item) => `${item.objectName} (${item.objectId})`).join(', ')
    const group =
      opts.kind === 'person' && imported.length > 1
        ? `${imported.length} people as separate objects: ${ids}`
        : ids
    return `Placed ${group} on the floor. Each figure is its own object — pose_object each id separately. Body pose comes from the photo. The chat photo stays attached — call this tool again if scale/pose is wrong. Do not invent XYZ. Do not pose other scene objects.`
  } catch (error) {
    opts.endLift(liftId)
    return `Error: ${error instanceof Error ? error.message : String(error)}`
  }
}
