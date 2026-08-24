import { fal } from '@fal-ai/client'
import { serverHasKey } from '../agent/serverKeys'

export type FalSubscribeOpts = {
  signal?: AbortSignal
  /** When true, Fal includes runner logs on queue updates (needed to parse real %). */
  logs?: boolean
  onQueueUpdate?: (status: unknown) => void
}

export type FalSubscribe = (
  modelId: string,
  input: Record<string, unknown>,
  opts?: FalSubscribeOpts,
) => Promise<unknown>

export type FalUpload = (file: File, signal?: AbortSignal) => Promise<string>

let credentials = ''
let subscribeImpl: FalSubscribe | null = null
let uploadImpl: FalUpload | null = null

export function configureFal(key: string) {
  credentials = key.trim()
}

export function getFalCredentials(): string {
  return credentials
}

/** Test seam — production uses `@fal-ai/client`. */
export function setFalTransportForTests(opts: {
  subscribe?: FalSubscribe | null
  upload?: FalUpload | null
}) {
  if ('subscribe' in opts) subscribeImpl = opts.subscribe ?? null
  if ('upload' in opts) uploadImpl = opts.upload ?? null
}

export function resetFalForTests() {
  credentials = ''
  subscribeImpl = null
  uploadImpl = null
}

/** True when any auth path exists: a personal key or the deployment's site key. */
export function falUsable(): boolean {
  return Boolean(credentials) || serverHasKey('fal')
}

function liveClient() {
  if (credentials) {
    // personal key (BYOK) — straight to fal from the browser
    fal.config({ credentials })
  } else if (serverHasKey('fal')) {
    // site key — the /api proxy attaches it server-side
    fal.config({ proxyUrl: '/api/fal/proxy' })
  } else {
    throw new Error('Add your Fal API key in Settings first.')
  }
  return fal
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw new DOMException('The user aborted a request.', 'AbortError')
}

export async function subscribe<T>(
  modelId: string,
  input: Record<string, unknown>,
  opts?: FalSubscribeOpts,
): Promise<T> {
  if (!falUsable()) {
    throw new Error('Add your Fal API key in Settings first.')
  }
  throwIfAborted(opts?.signal)
  if (subscribeImpl) {
    return (await subscribeImpl(modelId, input, opts)) as T
  }
  const client = liveClient()
  const result = await client.subscribe(modelId, {
    input,
    abortSignal: opts?.signal,
    logs: opts?.logs,
    onQueueUpdate: opts?.onQueueUpdate,
  })
  return result.data as T
}

export async function fileToDataUri(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const base64 = btoa(binary)
  const type = file.type || 'image/jpeg'
  return `data:${type};base64,${base64}`
}

const DATA_URI_LIMIT = 4_000_000

export async function uploadImage(file: File, signal?: AbortSignal): Promise<string> {
  return uploadFile(file, signal)
}

/** GLB uploads skip the data-URI path when they would blow past the size cap. */
export async function uploadFile(file: File, signal?: AbortSignal): Promise<string> {
  if (!falUsable()) {
    throw new Error('Add your Fal API key in Settings first.')
  }
  throwIfAborted(signal)
  if (uploadImpl) return uploadImpl(file, signal)
  if (file.size <= DATA_URI_LIMIT) return fileToDataUri(file)
  throwIfAborted(signal)
  return liveClient().storage.upload(file)
}
