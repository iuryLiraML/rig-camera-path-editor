import { idbPut, STORES } from './idb'

/** Provider data is preserved independently of any supported posing adapter. */
export interface BodyReconstruction {
  version: number
  provider: 'fal'
  model: string
  requestId?: string
  metadata: unknown
  source: { imageUrl: string; maskUrl?: string }
  /** Alignment is a separate operation; never replace the original body parameters. */
  alignment?: { metadata: unknown; model: string }
  artifacts: { role: string; bufferKey?: string; cloudAssetId?: string; url: string; error?: string }[]
}

export function reconstructionBufferKeys(reconstruction?: BodyReconstruction): string[] {
  return reconstruction?.artifacts.flatMap((artifact) => artifact.bufferKey ? [artifact.bufferKey] : []) ?? []
}

/** Save sidecars without turning a failed diagnostic download into a lost body. */
export async function persistReconstructionArtifacts(
  reconstruction: BodyReconstruction | undefined,
  signal?: AbortSignal,
  bodyBuffer?: ArrayBuffer,
  bodyBufferKey?: string,
): Promise<BodyReconstruction | undefined> {
  if (!reconstruction) return undefined
  const saved = structuredClone(reconstruction)
  for (const artifact of saved.artifacts) {
    if (artifact.bufferKey) continue
    try {
      let bytes: ArrayBuffer
      if (artifact.role === 'source-body' && bodyBufferKey && !reconstruction.alignment) {
        artifact.bufferKey = bodyBufferKey
        delete artifact.error
        continue
      } else if (artifact.role === 'source-body' && bodyBuffer && !reconstruction.alignment) bytes = bodyBuffer
      else {
        const response = await fetch(artifact.url, { signal })
        if (!response.ok) throw new Error(`Download failed (${response.status})`)
        bytes = await response.arrayBuffer()
      }
      const key = `body-artifact-${crypto.randomUUID()}`
      await idbPut(STORES.buffers, bytes, key)
      artifact.bufferKey = key
      delete artifact.error
    } catch {
      artifact.error = signal?.aborted ? 'Download cancelled' : 'Could not save this reconstruction file'
    }
  }
  return saved
}

/** Read only the documented subject envelope; no pose interpretation is implied. */
export function reconstructionMessage(reconstruction?: BodyReconstruction): string {
  if (!reconstruction) return 'Reconstruction data is unavailable for this asset. The original mesh is still usable.'
  if (reconstruction.version !== 1 || reconstruction.model !== 'fal-ai/sam-3/3d-body') return 'This reconstruction version is not supported. Its original data is retained.'
  const metadata = reconstruction.metadata
  if (!metadata || typeof metadata !== 'object' || !('people' in metadata) || !Array.isArray(metadata.people)) return 'The provider did not return usable person metadata. The original mesh is retained.'
  const people = metadata.people
  if (!('num_people' in metadata) || !Number.isInteger(metadata.num_people) || metadata.num_people !== people.length || !people.length) return 'The person metadata is incomplete. It is retained without applying a pose.'
  const ids = people.map((person: unknown) => person && typeof person === 'object' && 'person_id' in person ? person.person_id : null)
  if (ids.some((id) => typeof id !== 'number' || !Number.isInteger(id) || id < 0) || new Set(ids).size !== ids.length) return 'Person correspondence could not be verified. No pose will be applied.'
  if (people.length > 1) return `${people.length} people were reconstructed together. A single-character pose cannot be applied to this asset.`
  return 'Reconstruction data is saved. Rig conversion has not been validated yet.'
}
