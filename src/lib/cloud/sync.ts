import { idbGet, idbUpdate, STORES } from '../idb'
import { persistModelBuffer } from '../readModelFile'
import {
  createCloudProject,
  defaultWorkflowPayload,
  downloadCloudAsset,
  fetchCloudProject,
  sha256Hex,
  updateCloudProject,
  uploadCloudBytes,
} from './client'
import {
  emptyAssetMap,
  fromCloudEditorState,
  parseCloudEditorState,
  toCloudEditorState,
  type CloudAssetMap,
} from './editorSnapshot'
import { useCloudAuthStore } from '../../state/useCloudAuthStore'
import { useProjectStore, type Shot } from '../../state/useProjectStore'
import { migrateProjectWorkflow } from '../projectWorkflow'
import type { ProjectRecord } from '../projects'
import { useSaveStatusStore } from '../saveStatus'

export async function hydrateCloudProject(projectId: string): Promise<ProjectRecord> {
  const accessToken = useCloudAuthStore.getState().accessToken
  if (!accessToken) throw new Error('Sign in to load a cloud project.')

  const project = await fetchCloudProject(accessToken, projectId)
  const editorState = parseCloudEditorState(project.editorState ?? {})
  const shots: Shot[] = []
  for (const scene of editorState.scenes) {
    for (const shot of scene.shots) {
      let thumbnail: Blob | null = null
      if (shot.stillAssetId) {
        const bytes = await downloadCloudAsset(accessToken, shot.stillAssetId)
        thumbnail = new Blob([bytes], { type: 'image/jpeg' })
      }
      shots.push({
        id: shot.id,
        name: shot.name,
        order: shot.order,
        rig: shot.rig,
        format: shot.format,
        duration: shot.duration,
        thumbnail,
      })
    }

    for (const meta of scene.sceneMeta) {
      if (!meta.bufferKey || !meta.bufferAssetId) continue
      try {
        const bytes = await downloadCloudAsset(accessToken, meta.bufferAssetId)
        await persistModelBuffer(meta.bufferKey, bytes)
      } catch {
        throw new Error(`The GLB for “${meta.name}” is missing from storage.`)
      }
    }
  }

  const createdAt = Date.parse(project.updatedAt) || Date.now()
  return fromCloudEditorState(editorState, {
    id: project.id,
    name: project.name,
    createdAt,
    workflow: migrateProjectWorkflow(project.workflow, project.name),
    cloudUpdatedAt: project.updatedAt,
    shots,
  })
}

async function uploadDirtyAssets(
  accessToken: string,
  projectId: string,
  record: ProjectRecord,
): Promise<CloudAssetMap> {
  const assets: CloudAssetMap = {
    bufferAssets: { ...(record.bufferAssets ?? {}) },
    stillAssets: { ...(record.stillAssets ?? {}) },
  }

  for (const scene of record.scenes) {
    for (const meta of scene.sceneMeta) {
      if (!meta.bufferKey) continue
      const buffer = await idbGet<ArrayBuffer>(STORES.buffers, meta.bufferKey)
      if (!buffer) {
        throw new Error(`The model for “${meta.name}” is missing from this browser cache.`)
      }
      const sha256 = await sha256Hex(buffer)
      const existing = assets.bufferAssets[meta.bufferKey]
      if (existing?.sha256 === sha256) continue
      const format = meta.sourceFormat ?? 'glb'
      const uploaded = await uploadCloudBytes(
        accessToken,
        projectId,
        buffer,
        `${meta.name || 'model'}.${format}`,
        format === 'obj' ? 'text/plain' : format === 'gltf' ? 'model/gltf+json' : 'model/gltf-binary',
        format === 'obj' ? 'ingest-source' : 'glb',
      )
      assets.bufferAssets[meta.bufferKey] = uploaded
    }
  }

  for (const environment of record.environments ?? []) {
    const keys = [environment.bufferKey, environment.sourceImageKey].filter(
      (key): key is string => Boolean(key),
    )
    for (const key of keys) {
      const buffer = await idbGet<ArrayBuffer>(STORES.buffers, key)
      if (!buffer) continue
      const sha256 = await sha256Hex(buffer)
      const existing = assets.bufferAssets[key]
      if (existing?.sha256 === sha256) continue
      const name = key === environment.bufferKey ? `${environment.name || 'environment'}.ply` : `${environment.name}-photo.jpg`
      const uploaded = await uploadCloudBytes(
        accessToken,
        projectId,
        buffer,
        name,
        'application/octet-stream',
      )
      assets.bufferAssets[key] = uploaded
    }
  }

  for (const asset of record.unplacedAssets ?? []) {
    const buffer = await idbGet<ArrayBuffer>(STORES.buffers, asset.bufferKey)
    if (!buffer) continue
    const sha256 = await sha256Hex(buffer)
    const existing = assets.bufferAssets[asset.bufferKey]
    if (existing?.sha256 === sha256) continue
    const uploaded = await uploadCloudBytes(
      accessToken,
      projectId,
      buffer,
      `${asset.name || 'asset'}.glb`,
      'model/gltf-binary',
      'glb',
    )
    assets.bufferAssets[asset.bufferKey] = uploaded
  }

  for (const scene of record.scenes) {
    for (const shot of scene.shots) {
      if (!shot.thumbnail) {
        delete assets.stillAssets[shot.id]
        continue
      }
      const bytes = await shot.thumbnail.arrayBuffer()
      const sha256 = await sha256Hex(bytes)
      const existing = assets.stillAssets[shot.id]
      if (existing?.sha256 === sha256) continue
      const type = shot.thumbnail.type === 'image/png' ? 'image/png' : 'image/jpeg'
      const uploaded = await uploadCloudBytes(
        accessToken,
        projectId,
        shot.thumbnail,
        `${shot.id}.${type === 'image/png' ? 'png' : 'jpg'}`,
        type,
      )
      assets.stillAssets[shot.id] = uploaded
    }
  }

  return assets
}

const syncs = new Map<string, { promise: Promise<void>; again: boolean; token: string }>()

/** One drain per account/project. Overlapping callers share creation, uploads and acknowledgements. */
export function syncProjectToCloud(projectId: string, options?: { ifMatch?: string }): Promise<void> {
  const auth = useCloudAuthStore.getState()
  const accessToken = auth.accessToken
  if (!accessToken || auth.status !== 'signed-in') return Promise.resolve()
  const key = `${auth.session?.tenantId ?? ''}:${auth.session?.userId ?? ''}:${projectId}`
  const running = syncs.get(key)
  if (running?.token === accessToken) {
    running.again = true
    return running.promise
  }
  const entry = { promise: Promise.resolve(), again: false, token: accessToken }
  const currentSession = () => useCloudAuthStore.getState().accessToken === accessToken
    && useCloudAuthStore.getState().status === 'signed-in'
  useSaveStatusStore.getState().setCloudStatus(projectId, 'syncing')
  entry.promise = (async () => {
    let matcher = options?.ifMatch
    do {
      entry.again = false
      let record = await idbGet<ProjectRecord>(STORES.projects, projectId)
      if (!record || !currentSession()) return
      if (!matcher && record.contentRevision && record.contentRevision === record.cloudSyncedRevision) break
      if (!record.cloudProjectId) {
        const payload = defaultWorkflowPayload(record.workflow)
        const created = await createCloudProject(accessToken, {
          name: record.name,
          workflowVersion: payload.workflowVersion,
          workflow: payload.workflow,
          editorState: toCloudEditorState(record, emptyAssetMap()),
          idempotencyKey: record.id,
        })
        if (!currentSession()) return
        record = await idbUpdate<ProjectRecord>(STORES.projects, projectId, (latest) => ({
          ...latest, cloudProjectId: created.id, cloudUpdatedAt: created.updatedAt,
        }))
        if (!record) return
      }
      const ifMatch = matcher ?? record.cloudUpdatedAt
      matcher = undefined
      if (!ifMatch) throw new Error('Cloud save is missing a version matcher. Reload the project and try again.')
      await pushSnapshot(accessToken, record.cloudProjectId!, record, ifMatch, currentSession)
      if (!currentSession()) return
      const latest = await idbGet<ProjectRecord>(STORES.projects, projectId)
      if (!latest) return
      entry.again ||= latest.contentRevision !== record.contentRevision || latest.updatedAt !== record.updatedAt
    } while (entry.again)
    useSaveStatusStore.getState().setCloudStatus(projectId, 'saved')
  })().catch((error) => {
    useSaveStatusStore.getState().setCloudStatus(projectId, 'error')
    throw error
  }).finally(() => {
    if (syncs.get(key) === entry) syncs.delete(key)
  })
  syncs.set(key, entry)
  return entry.promise
}

export async function syncActiveProjectToCloud(options?: { ifMatch?: string }): Promise<void> {
  const { projectId } = useProjectStore.getState()
  if (!projectId) return
  await syncProjectToCloud(projectId, options)
}

async function pushSnapshot(
  accessToken: string,
  cloudProjectId: string,
  record: ProjectRecord,
  ifMatch: string,
  currentSession: () => boolean,
): Promise<void> {
  const assets = await uploadDirtyAssets(accessToken, cloudProjectId, record)
  if (!currentSession()) return
  const payload = defaultWorkflowPayload(record.workflow)
  const updated = await updateCloudProject(
    accessToken,
    cloudProjectId,
    {
      name: record.name,
      workflow: payload.workflow,
      editorState: toCloudEditorState(record, assets),
    },
    ifMatch,
  )
  if (!currentSession()) return
  await idbUpdate<ProjectRecord>(STORES.projects, record.id, (latest) => ({
    ...latest,
    cloudProjectId,
    cloudUpdatedAt: updated.updatedAt,
    cloudSyncedRevision: record.contentRevision,
    bufferAssets: { ...latest.bufferAssets, ...assets.bufferAssets },
    stillAssets: { ...latest.stillAssets, ...assets.stillAssets },
  }))
  if (useCloudAuthStore.getState().saveConflict?.projectId === record.id) {
    useCloudAuthStore.getState().setSaveConflict(null)
  }
}
