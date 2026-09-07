/**
 * Which AI vendors have a shared site key on the deployment (Vercel env vars,
 * attached server-side by the /api proxy). Only booleans ever reach the
 * browser. When a vendor has a site key, the client calls the same-origin
 * /api routes with no credentials; a personal key typed in Settings still
 * wins and goes directly to the vendor (BYOK override).
 */

export interface ServerKeys {
  anthropic: boolean
  kimi: boolean
  fal: boolean
}

export const NO_SERVER_KEYS: ServerKeys = { anthropic: false, kimi: false, fal: false }

let cached: ServerKeys = NO_SERVER_KEYS

/** Fetch /api/agent-config once at boot. Any failure means "no site keys". */
export async function loadServerKeys(): Promise<ServerKeys> {
  try {
    const res = await fetch('/api/agent-config')
    if (!res.ok) return cached
    const body = (await res.json()) as Partial<ServerKeys>
    cached = {
      anthropic: Boolean(body.anthropic),
      kimi: Boolean(body.kimi),
      fal: Boolean(body.fal),
    }
  } catch {
    // offline or a deployment without the proxy — BYOK keeps working
  }
  return cached
}

/** Synchronous read of the boot-time result (request paths, not React). */
export function serverHasKey(provider: keyof ServerKeys): boolean {
  return cached[provider]
}

export function setServerKeysForTests(keys: ServerKeys | null): void {
  cached = keys ?? NO_SERVER_KEYS
}
