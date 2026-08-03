import { PROJECT_WORKFLOW_VERSION } from '../projectWorkflow'

export interface CloudSession {
  userId: string
  tenantId: string
}

export interface CloudProjectSummary {
  id: string
  name: string
  workflowVersion: number
  workflow: unknown
  updatedAt: string
}

export interface BeginAssetUploadInput {
  projectId: string
  fileName: string
  contentType: string
  byteSize: number
  sha256: string
}

export interface BeginAssetUploadResult {
  assetId: string
  url: string
  expiresAt: string
  headers: Record<string, string>
}

export class CloudApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'CloudApiError'
  }
}

function cloudApiBase() {
  return import.meta.env.VITE_CLOUD_API_BASE?.trim() || '/api'
}

async function parseError(response: Response): Promise<CloudApiError> {
  let code: string | undefined
  try {
    const body = (await response.json()) as { error?: string }
    code = body.error
  } catch {
    // Response body may not be JSON.
  }
  return new CloudApiError(code ?? `Request failed (${response.status})`, response.status, code)
}

export async function cloudFetch(
  path: string,
  init: RequestInit & { accessToken?: string | null } = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.accessToken) headers.set('authorization', `Bearer ${init.accessToken}`)
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }
  const response = await fetch(`${cloudApiBase()}${path}`, {
    ...init,
    headers,
  })
  if (!response.ok) throw await parseError(response)
  return response
}

export async function fetchCloudSession(accessToken: string): Promise<CloudSession> {
  const response = await cloudFetch('/v1/session', { accessToken })
  return (await response.json()) as CloudSession
}

export async function listCloudProjects(accessToken: string): Promise<CloudProjectSummary[]> {
  const response = await cloudFetch('/v1/projects', { accessToken })
  const body = (await response.json()) as { projects: CloudProjectSummary[] }
  return body.projects
}

export async function createCloudProject(
  accessToken: string,
  input: { name: string; workflowVersion: number; workflow: unknown },
): Promise<CloudProjectSummary> {
  const response = await cloudFetch('/v1/projects', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(input),
  })
  const body = (await response.json()) as { project: CloudProjectSummary }
  return body.project
}

export async function updateCloudProject(
  accessToken: string,
  projectId: string,
  input: { name?: string; workflow?: unknown },
): Promise<CloudProjectSummary> {
  const response = await cloudFetch(`/v1/projects/${projectId}`, {
    method: 'PATCH',
    accessToken,
    body: JSON.stringify(input),
  })
  const body = (await response.json()) as { project: CloudProjectSummary }
  return body.project
}

export async function storeProviderCredential(
  accessToken: string,
  input: { provider: string; secret: string },
): Promise<{ credentialId: string; provider: string }> {
  const response = await cloudFetch('/v1/provider-credentials', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(input),
  })
  return (await response.json()) as { credentialId: string; provider: string }
}

export async function beginCloudAssetUpload(
  accessToken: string,
  input: BeginAssetUploadInput,
): Promise<BeginAssetUploadResult> {
  const response = await cloudFetch('/v1/assets/uploads', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(input),
  })
  return (await response.json()) as BeginAssetUploadResult
}

export async function uploadCloudAsset(
  accessToken: string,
  projectId: string,
  file: File,
  sha256: string,
  contentType?: string,
): Promise<string> {
  const resolvedContentType = contentType ?? file.type
  if (!resolvedContentType) {
    throw new CloudApiError('Asset content type is required', 400)
  }
  const upload = await beginCloudAssetUpload(accessToken, {
    projectId,
    fileName: file.name,
    contentType: resolvedContentType,
    byteSize: file.size,
    sha256,
  })
  const response = await fetch(upload.url, {
    method: 'PUT',
    headers: upload.headers,
    body: file,
  })
  if (!response.ok) {
    throw new CloudApiError('Asset upload failed', response.status)
  }
  return upload.assetId
}

export async function enqueueCloudCameraBatch(
  accessToken: string,
  input: {
    projectId: string
    shotListRevisionId: string
    credentialId: string
    idempotencyKey: string
  },
): Promise<{ jobRunId: string; created: boolean; status: string }> {
  const response = await cloudFetch(`/v1/projects/${input.projectId}/camera-batches`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({
      shotListRevisionId: input.shotListRevisionId,
      credentialId: input.credentialId,
      idempotencyKey: input.idempotencyKey,
    }),
  })
  return (await response.json()) as { jobRunId: string; created: boolean; status: string }
}

export async function fetchCloudJob(
  accessToken: string,
  jobRunId: string,
): Promise<{ id: string; kind: string; status: string; projectId: string | null }> {
  const response = await cloudFetch(`/v1/jobs/${jobRunId}`, { accessToken })
  const body = (await response.json()) as {
    job: { id: string; kind: string; status: string; projectId: string | null }
  }
  return body.job
}

export function defaultWorkflowPayload(workflow: unknown) {
  return {
    workflowVersion: PROJECT_WORKFLOW_VERSION,
    workflow,
  }
}
