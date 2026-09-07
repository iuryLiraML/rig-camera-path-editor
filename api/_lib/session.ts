/**
 * Signed, expiring cookie values — HMAC-SHA256 via Web Crypto, no JWT
 * library needed (there's no cookie/session code anywhere else in this repo
 * to build on, so this is intentionally minimal). Used for both the OAuth
 * CSRF "state" cookie and the long-lived session cookie set after a
 * verified Google login. Pure Web-API, runs the same on Vercel Edge and
 * under the Vite dev server.
 */

const encoder = new TextEncoder()

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of arr) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

/** `payload.signature` — payload is base64url JSON, signature is base64url HMAC-SHA256 over it. */
export async function signValue(payload: unknown, secret: string): Promise<string> {
  const json = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const key = await hmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(json))
  return `${json}.${toBase64Url(signature)}`
}

/**
 * Verifies the signature and returns the decoded payload, or null if it's
 * missing, malformed, or tampered with. `crypto.subtle.verify` compares in
 * constant time — a hand-rolled byte comparison wouldn't.
 */
export async function verifySignedValue<T>(token: string, secret: string): Promise<T | null> {
  const sep = token.indexOf('.')
  if (sep < 0) return null
  const json = token.slice(0, sep)
  const signature = token.slice(sep + 1)
  const key = await hmacKey(secret)
  let valid: boolean
  try {
    valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(signature), encoder.encode(json))
  } catch {
    return null
  }
  if (!valid) return null
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(json))) as T
  } catch {
    return null
  }
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return out
}

const SESSION_COOKIE = 'rig_session'
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30 // 30 days

interface SessionPayload {
  email: string
  exp: number // unix seconds
}

/** Small on purpose — an email and a timestamp, nowhere near Edge Middleware's 32KB header budget. */
export async function createSessionCookie(email: string, secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S
  const token = await signValue({ email, exp } satisfies SessionPayload, secret)
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

/** The signed-in email, or null if the cookie is absent, tampered with, or expired. */
export async function readSessionEmail(cookieHeader: string | null, secret: string): Promise<string | null> {
  const raw = parseCookies(cookieHeader)[SESSION_COOKIE]
  if (!raw) return null
  const payload = await verifySignedValue<SessionPayload>(raw, secret)
  if (!payload) return null
  if (payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload.email
}

const STATE_COOKIE = 'rig_oauth_state'
const STATE_MAX_AGE_S = 60 * 10 // 10 minutes — only needs to survive the Google round trip

/** CSRF guard for the OAuth redirect: a random value set before Google, checked on the way back. */
export function createStateCookie(state: string): string {
  return `${STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${STATE_MAX_AGE_S}`
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export function readState(cookieHeader: string | null): string | null {
  return parseCookies(cookieHeader)[STATE_COOKIE] ?? null
}

export function randomState(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}
