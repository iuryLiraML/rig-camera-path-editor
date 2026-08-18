import { PROJECT_WORKFLOW_VERSION } from '../projectWorkflow'

export interface CloudSession {
  userId: string
  tenantId: string
  email: string | null
  name: string | null
  picture: string | null
}

export interface CloudProjectSummary {
  id: string
  name: string
  workflowVersion: number
  workflow: unknown
  editorState: unknown
  updatedAt: string
}

export interface CloudCredentialSummary {
  id: string
  provider: string
}

export interface BeginAssetUploadInput {
  projectId: string
  fileName: string
  contentType: string
  byteSize: number
  sha256: string
  /** GS AssetRef / ingest-source kind; stored in asset metadata on the API. */
  kind?: 'streamed-sog' | 'glb' | 'collider-mesh' | 'heightfield' | 'ingest-source'
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

export class CloudConflictError extends CloudApiError {
  constructor(readonly updatedAt: string) {
    super('This project was saved on another device.', 409, 'project_conflict')
    this.name = 'CloudConflictError'
  }
}

/** Team Vercel sets this; local Vite without it stays an implementer sandbox (D45). */
export function isTeamCloudApp(): boolean {
  return Boolean(import.meta.env.VITE_CLOUD_API_BASE?.trim())
}

export const CLOUD_ACCESS_TOKEN_KEY = 'rig-cloud-access-token'

function cloudApiBase() {
  return import.meta.env.VITE_CLOUD_API_BASE?.trim() || '/api'
}

export async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function parseError(response: Response): Promise<CloudApiError> {
  let code: string | undefined
  let message: string | undefined
  let updatedAt: string | undefined
  try {
    const body = (await response.json()) as {
      error?: string
      message?: string
      updatedAt?: string
    }
    code = body.error
    message = body.message
    updatedAt = body.updatedAt
  } catch {
    // Response body may not be JSON.
  }
  if (response.status === 409 && typeof updatedAt === 'string' && updatedAt.length > 0) {
    return new CloudConflictError(updatedAt)
  }
  if (code === 'not_on_studio_list') {
    return new CloudApiError(
      message ?? 'This Google account is not on the studio list.',
      response.status,
      code,
    )
  }
  return new CloudApiError(message ?? code ?? `Request failed (${response.status})`, response.status, code)
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

export async function fetchCloudProject(
  accessToken: string,
  projectId: string,
): Promise<CloudProjectSummary> {
  const response = await cloudFetch(`/v1/projects/${projectId}`, { accessToken })
  const body = (await response.json()) as { project: CloudProjectSummary }
  return body.project
}

export async function createCloudProject(
  accessToken: string,
  input: {
    name: string
    workflowVersion: number
    workflow: unknown
    editorState?: unknown
  },
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
  input: { name?: string; workflow?: unknown; editorState?: unknown },
  ifMatch: string,
): Promise<CloudProjectSummary> {
  const response = await cloudFetch(`/v1/projects/${projectId}`, {
    method: 'PATCH',
    accessToken,
    headers: { 'if-match': ifMatch },
    body: JSON.stringify(input),
  })
  const body = (await response.json()) as { project: CloudProjectSummary }
  return body.project
}

export async function listOwnCredentials(accessToken: string): Promise<CloudCredentialSummary[]> {
  const response = await cloudFetch('/v1/provider-credentials', { accessToken })
  const body = (await response.json()) as { credentials: CloudCredentialSummary[] }
  return body.credentials
}

export async function retrieveOwnCredential(
  accessToken: string,
  credentialId: string,
): Promise<{ id: string; provider: string; secret: string }> {
  const response = await cloudFetch(`/v1/provider-credentials/${credentialId}`, { accessToken })
  return (await response.json()) as { id: string; provider: string; secret: string }
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

export async function uploadCloudBytes(
  accessToken: string,
  projectId: string,
  bytes: ArrayBuffer | Blob,
  fileName: string,
  contentType: string,
  kind?: BeginAssetUploadInput['kind'],
): Promise<{ assetId: string; sha256: string }> {
  const buffer = bytes instanceof Blob ? await bytes.arrayBuffer() : bytes
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: contentType })
  const sha256 = await sha256Hex(buffer)
  const upload = await beginCloudAssetUpload(accessToken, {
    projectId,
    fileName,
    contentType,
    byteSize: blob.size,
    sha256,
    kind,
  })
  const response = await fetch(upload.url, {
    method: 'PUT',
    headers: upload.headers,
    body: blob,
  })
  if (!response.ok) {
    throw new CloudApiError('Asset upload failed', response.status)
  }
  return { assetId: upload.assetId, sha256 }
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

export async function downloadCloudAsset(
  accessToken: string,
  assetId: string,
): Promise<ArrayBuffer> {
  const signed = await cloudFetch(`/v1/assets/${assetId}`, { accessToken })
  const body = (await signed.json()) as { url: string }
  const response = await fetch(body.url)
  if (!response.ok) {
    throw new CloudApiError('Asset download failed', response.status)
  }
  return response.arrayBuffer()
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
