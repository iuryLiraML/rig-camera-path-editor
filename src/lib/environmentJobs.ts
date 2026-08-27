import { idbGet, STORES } from './idb'
import { persistModelBuffer } from './readModelFile'
import {
  environmentDeleteMessage,
  environmentFileKind,
  environmentRecordFormat,
  type EnvironmentFormat,
  type ProjectEnvironment,
  type ProjectMeshAsset,
  type RigKind,
} from './environment'
import { assertGaussianSplat } from './assetSniff'
import { generateTripoSplat } from './fal/tripoSplat'
import { configureFal, falUsable, uploadImage } from './fal/client'
import { combineAbortSignals, finishFalJobAbort, isFalAbortError, startFalJobAbort } from './fal/jobAbort'
import { readFalAbortSignal } from './fal/settings'
import { useAgentStore } from '../state/useAgentStore'
import {
  makeEnvironmentId,
  makeUnplacedId,
  useEnvironmentStore,
} from '../state/useEnvironmentStore'
import { useSceneStore } from '../state/useSceneStore'
import { IDENTITY_ENV_TRANSFORM } from './environment'

export async function loadLiveEnvironmentBuffer() {
  const env = useEnvironmentStore.getState()
  const id = env.environmentId
  if (!id) {
    env.setLiveBuffer(null, null)
    env.setSourceImage(null)
    return
  }
  const record = env.environments.find((item) => item.id === id)
  if (!record) {
    env.setLiveBuffer(null, null)
    return
  }
  const buffer = await idbGet<ArrayBuffer>(STORES.buffers, record.bufferKey)
  env.setLiveBuffer(buffer ?? null, environmentRecordFormat(record))
  if (record.sourceImageKey) {
    const image = await idbGet<ArrayBuffer>(STORES.buffers, record.sourceImageKey)
    env.setSourceImage(image ? new Blob([image]) : null)
  } else {
    env.setSourceImage(null)
  }
}

export function hydrateEnvironmentFromRecord(data: {
  environments?: ProjectEnvironment[]
  unplacedAssets?: ProjectMeshAsset[]
  sceneBindings?: { id: string; environmentId: string | null }[]
  environmentId?: string | null
  environmentTransform?: typeof IDENTITY_ENV_TRANSFORM | null
}) {
  useEnvironmentStore.getState().hydrate({
    environments: data.environments ?? [],
    unplacedAssets: data.unplacedAssets ?? [],
    sceneBindings: data.sceneBindings,
    environmentId: data.environmentId,
    environmentTransform: data.environmentTransform,
  })
}

export async function importEnvironmentFile(file: File): Promise<string | null> {
  if (!environmentFileKind(file.name)) {
    useSceneStore.getState().showNotice('Environment import accepts .ply or .splat only')
    return null
  }
  const buffer = await file.arrayBuffer()
  try {
    const format = assertGaussianSplat(buffer, file.name)
    return addEnvironmentBuffer(
      buffer,
      file.name.replace(/\.(ply|splat)$/i, '') || 'Environment',
      'import',
      format,
    )
  } catch (error) {
    useSceneStore.getState().showNotice(error instanceof Error ? error.message : 'Environment import failed')
    return null
  }
}

export async function generateEnvironmentFromPhoto(
  file: File,
  opts?: { signal?: AbortSignal },
): Promise<string | null> {
  const scene = useSceneStore.getState()
  if (!falUsable()) {
    scene.showNotice('Add your Fal API key in Settings first.')
    return null
  }
  configureFal(useAgentStore.getState().falKey)
  const ownsJob = !opts?.signal
  const liftId = ownsJob ? scene.beginLift('Generating environment…', 'generate') : null
  const signal = ownsJob
    ? combineAbortSignals(startFalJobAbort(liftId!), readFalAbortSignal())
    : opts.signal
  try {
    const imageUrl = await uploadImage(file, signal, { storage: true })
    const { buffer, fileName, format } = await generateTripoSplat({ imageUrl, signal })
    const name = file.name.replace(/\.[^.]+$/, '') || 'Environment'
    const id = await addEnvironmentBuffer(buffer, name, 'triposplat', format, file, fileName)
    scene.showNotice('Environment ready')
    return id
  } catch (error) {
    console.error(error)
    scene.showNotice(
      isFalAbortError(error)
        ? 'Environment generate cancelled.'
        : error instanceof Error
          ? error.message
          : 'Environment generate failed',
    )
    return null
  } finally {
    if (liftId) {
      finishFalJobAbort(liftId)
      useSceneStore.getState().endLift(liftId)
    }
  }
}

async function addEnvironmentBuffer(
  buffer: ArrayBuffer,
  name: string,
  source: ProjectEnvironment['source'],
  format: EnvironmentFormat,
  sourceImage?: File,
  fileName?: string,
): Promise<string> {
  const id = makeEnvironmentId()
  const bufferKey = id
  await persistModelBuffer(bufferKey, buffer)
  let sourceImageKey: string | undefined
  if (sourceImage) {
    sourceImageKey = `${id}-photo`
    await persistModelBuffer(sourceImageKey, await sourceImage.arrayBuffer())
  }
  const record: ProjectEnvironment = {
    id,
    name: fileName?.replace(/\.(ply|splat)$/i, '') || name,
    bufferKey,
    source,
    createdAt: Date.now(),
    format,
    sourceImageKey,
  }
  const store = useEnvironmentStore.getState()
  store.setEnvironments([...store.environments, record])
  store.assignEnvironment(id)
  store.setLiveBuffer(buffer, format)
  store.setSourceImage(sourceImage ?? null)
  return id
}

export function assignStoredEnvironment(environmentId: string) {
  useEnvironmentStore.getState().assignEnvironment(environmentId)
  void loadLiveEnvironmentBuffer()
}

export function clearActiveEnvironment() {
  useEnvironmentStore.getState().clearEnvironment()
}

export function deleteStoredEnvironment(environmentId: string): string | null {
  const live = useEnvironmentStore.getState()
  const blocked = environmentDeleteMessage(live.sceneBindings, environmentId)
  if (blocked) {
    useSceneStore.getState().showNotice(blocked)
    return blocked
  }
  live.setEnvironments(live.environments.filter((item) => item.id !== environmentId))
  if (live.environmentId === environmentId) live.clearEnvironment()
  return null
}

export async function parkUnplacedAsset(opts: {
  buffer: ArrayBuffer
  name: string
  rigKind: RigKind
}): Promise<{ assetId: string; objectName: string }> {
  const id = makeUnplacedId()
  await persistModelBuffer(id, opts.buffer)
  const asset: ProjectMeshAsset = {
    id,
    name: opts.name,
    bufferKey: id,
    rigKind: opts.rigKind,
  }
  const store = useEnvironmentStore.getState()
  store.setUnplacedAssets([...store.unplacedAssets, asset])
  useSceneStore.getState().showNotice(`"${opts.name}" added to Unplaced`)
  return { assetId: id, objectName: opts.name }
}

export async function instantiateUnplaced(assetId: string): Promise<string | null> {
  const asset = useEnvironmentStore.getState().unplacedAssets.find((item) => item.id === assetId)
  if (!asset) return null
  const buffer = await idbGet<ArrayBuffer>(STORES.buffers, asset.bufferKey)
  if (!buffer) {
    useSceneStore.getState().showNotice(`"${asset.name}" is missing its file`)
    return null
  }
  const { importModelBuffer } = await import('./sceneIO')
  const imported = await importModelBuffer(buffer.slice(0), asset.name, { announce: true })
  if (!imported) return null
  useSceneStore.setState((s) => ({
    objects: s.objects.map((item) =>
      item.id === imported.objectId
        ? {
            ...item,
            rigKind: asset.rigKind,
            bufferKey: asset.bufferKey,
            playClips: asset.rigKind === 'dummy',
          }
        : item,
    ),
  }))
  return imported.objectId
}

/** Copy-on-write when an instance shares its GLB with Unplaced or another object. */
export async function isolateSharedObjectBuffer(objectId: string): Promise<string | null> {
  const object = useSceneStore.getState().objects.find((item) => item.id === objectId)
  if (!object?.bufferKey) return null
  const key = object.bufferKey
  const sharedOnScene = useSceneStore
    .getState()
    .objects.some((item) => item.id !== objectId && item.bufferKey === key)
  const sharedOnShelf = useEnvironmentStore.getState().unplacedAssets.some((asset) => asset.bufferKey === key)
  if (!sharedOnScene && !sharedOnShelf) return key
  const nextKey = objectId === key ? makeUnplacedId() : objectId
  const source = await idbGet<ArrayBuffer>(STORES.buffers, key)
  if (source && source.byteLength > 0) await persistModelBuffer(nextKey, source.slice(0))
  useSceneStore.setState((s) => ({
    objects: s.objects.map((item) => (item.id === objectId ? { ...item, bufferKey: nextKey } : item)),
  }))
  return nextKey
}
