import { idbGet, idbPut, STORES } from '../idb'
import {
  createCloudProject,
  defaultWorkflowPayload,
  updateCloudProject,
} from './client'
import { useCloudAuthStore } from '../../state/useCloudAuthStore'
import { useProjectStore } from '../../state/useProjectStore'

interface ProjectRecord {
  id: string
  cloudProjectId?: string
  name: string
  createdAt: number
  workflow?: unknown
}

export async function syncActiveProjectToCloud(): Promise<void> {
  const accessToken = useCloudAuthStore.getState().accessToken
  if (!accessToken || useCloudAuthStore.getState().status !== 'signed-in') return

  const { projectId, name, workflow } = useProjectStore.getState()
  if (!projectId) return

  const record = await idbGet<ProjectRecord>(STORES.projects, projectId)
  if (!record) return

  const payload = defaultWorkflowPayload(workflow)
  if (record.cloudProjectId) {
    await updateCloudProject(accessToken, record.cloudProjectId, {
      name,
      workflow: payload.workflow,
    })
    return
  }

  const created = await createCloudProject(accessToken, {
    name,
    workflowVersion: payload.workflowVersion,
    workflow: payload.workflow,
  })
  await idbPut(STORES.projects, {
    ...record,
    cloudProjectId: created.id,
  })
}
