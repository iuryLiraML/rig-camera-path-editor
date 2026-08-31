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

function detailFromUnknown(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed && trimmed !== '[object Object]' ? trimmed : null
  }
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  if (typeof rec.msg === 'string') return detailFromUnknown(rec.msg)
  if (typeof rec.message === 'string') return detailFromUnknown(rec.message)
  if (Array.isArray(rec.detail)) {
    const parts = rec.detail.map((item) => detailFromUnknown(item)).filter((item): item is string => Boolean(item))
    return parts.length ? parts.join(' ') : null
  }
  if (rec.detail != null) return detailFromUnknown(rec.detail)
  if (rec.body != null) return detailFromUnknown(rec.body)
  return null
}

/** Fal often throws a non-Error `{ status, body: { detail } }` — `instanceof Error` drops that. */
export function falErrorMessage(error: unknown, fallback = 'The Fal request failed.'): string {
  if (typeof error === 'string' && error.trim()) return error.trim()
  const fromBody =
    error && typeof error === 'object' ? detailFromUnknown((error as { body?: unknown }).body) : null
  if (fromBody) return fromBody
  const fromSelf = detailFromUnknown(error)
  if (fromSelf) return fromSelf
  if (error instanceof Error && error.message.trim() && error.message !== '[object Object]') {
    return error.message.trim()
  }
  return fallback
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
  try {
    const result = await client.subscribe(modelId, {
      input,
      abortSignal: opts?.signal,
      logs: opts?.logs,
      onQueueUpdate: opts?.onQueueUpdate,
    })
    const data = result && typeof result === 'object' && 'data' in result ? result.data : result
    if (data == null) throw new Error(`${modelId} returned an empty payload.`)
    return data as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError') {
      throw error
    }
    throw new Error(falErrorMessage(error, `${modelId} failed.`))
  }
}

export const DATA_URI_LIMIT = 4_000_000

/** GLBs / splats must not take the data-URI path — base64 of a mesh freezes the editor. */
export function uploadUsesDataUri(file: File): boolean {
  if (file.size > DATA_URI_LIMIT) return false
  if (file.type === 'model/gltf-binary' || /\.glb$/i.test(file.name)) return false
  if (/\.(ply|splat)$/i.test(file.name)) return false
  return true
}

export async function fileToDataUri(file: File): Promise<string> {
  if (typeof FileReader === 'function') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
      reader.readAsDataURL(file)
    })
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunks: string[] = []
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + step)))
    if (i > 0 && i % (step * 32) === 0) await Promise.resolve()
  }
  const type = file.type || 'image/jpeg'
  return `data:${type};base64,${btoa(chunks.join(''))}`
}

export async function uploadImage(
  file: File,
  signal?: AbortSignal,
  opts?: { storage?: boolean },
): Promise<string> {
  return uploadFile(file, signal, opts)
}

/** GLB remesh uploads always go through Fal storage, never base64. */
export async function uploadFile(
  file: File,
  signal?: AbortSignal,
  opts?: { storage?: boolean },
): Promise<string> {
  if (!falUsable()) {
    throw new Error('Add your Fal API key in Settings first.')
  }
  throwIfAborted(signal)
  if (uploadImpl) return uploadImpl(file, signal)
  if (!opts?.storage && uploadUsesDataUri(file)) return fileToDataUri(file)
  throwIfAborted(signal)
  const uploaded = liveClient().storage.upload(file)
  if (!signal) return uploaded
  return Promise.race([
    uploaded,
    new Promise<never>((_, reject) => {
      const fail = () => reject(new DOMException('The user aborted a request.', 'AbortError'))
      if (signal.aborted) {
        fail()
        return
      }
      signal.addEventListener('abort', fail, { once: true })
    }),
  ])
}
