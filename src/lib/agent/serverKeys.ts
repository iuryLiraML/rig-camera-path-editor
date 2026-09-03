/**
 * Which AI vendors have a shared site key on the deployment (Vercel env vars,
 * attached server-side by the /api proxy). Only booleans ever reach the
 * browser: the client calls the same-origin /api routes with no credentials.
 *
 * `anthropic` false means the Director cannot run at all — there is no
 * browser-side key to fall back on, which is why Settings surfaces it as a
 * deployment problem rather than something the user can fix in the UI. Fal
 * still supports a personal key typed in Settings (BYOK override).
 */

export interface ServerKeys {
  anthropic: boolean
  fal: boolean
}

export const NO_SERVER_KEYS: ServerKeys = { anthropic: false, fal: false }

let cached: ServerKeys = NO_SERVER_KEYS

/** Fetch /api/agent-config once at boot. Any failure means "no site keys". */
export async function loadServerKeys(): Promise<ServerKeys> {
  try {
    const res = await fetch('/api/agent-config')
    if (!res.ok) return cached
    const body = (await res.json()) as Partial<ServerKeys>
    cached = {
      anthropic: Boolean(body.anthropic),
      fal: Boolean(body.fal),
    }
  } catch {
    // offline, or a deployment without the proxy — treated as "no site keys"
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
