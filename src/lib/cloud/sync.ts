import { idbGet, idbPut, STORES } from '../idb'
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

export async function syncActiveProjectToCloud(options?: { ifMatch?: string }): Promise<void> {
  const accessToken = useCloudAuthStore.getState().accessToken
  if (!accessToken || useCloudAuthStore.getState().status !== 'signed-in') return

  const { projectId, name, workflow } = useProjectStore.getState()
  if (!projectId) return

  const record = await idbGet<ProjectRecord>(STORES.projects, projectId)
  if (!record) return

  const payload = defaultWorkflowPayload(workflow)
  const editorStateSeed = toCloudEditorState(record, emptyAssetMap())

  if (!record.cloudProjectId) {
    const created = await createCloudProject(accessToken, {
      name,
      workflowVersion: payload.workflowVersion,
      workflow: payload.workflow,
      editorState: editorStateSeed,
    })
    const withCloud: ProjectRecord = {
      ...record,
      cloudProjectId: created.id,
      cloudUpdatedAt: created.updatedAt,
    }
    await idbPut(STORES.projects, withCloud)
    await pushSnapshot(accessToken, created.id, withCloud, created.updatedAt)
    return
  }

  const ifMatch = options?.ifMatch ?? record.cloudUpdatedAt
  if (!ifMatch) {
    throw new Error('Cloud save is missing a version matcher. Reload the project and try again.')
  }
  await pushSnapshot(accessToken, record.cloudProjectId, record, ifMatch)
}

async function pushSnapshot(
  accessToken: string,
  cloudProjectId: string,
  record: ProjectRecord,
  ifMatch: string,
): Promise<void> {
  const assets = await uploadDirtyAssets(accessToken, cloudProjectId, record)
  const { name, workflow } = useProjectStore.getState()
  const payload = defaultWorkflowPayload(workflow)
  const updated = await updateCloudProject(
    accessToken,
    cloudProjectId,
    {
      name,
      workflow: payload.workflow,
      editorState: toCloudEditorState({ ...record, name }, assets),
    },
    ifMatch,
  )
  await idbPut(STORES.projects, {
    ...record,
    name,
    cloudProjectId,
    cloudUpdatedAt: updated.updatedAt,
    bufferAssets: assets.bufferAssets,
    stillAssets: assets.stillAssets,
  })
  useCloudAuthStore.getState().setSaveConflict(null)
}
