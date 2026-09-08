import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALLOWED_LLM_PATHS } from './_lib/agentApi'

/**
 * Vercel's `[...path]` catch-all matched only a SINGLE path segment on this
 * project, so `api/anthropic/[...path].ts` served `/api/anthropic/v1` but let
 * `/api/anthropic/v1/messages` fall through to the platform's own NOT_FOUND —
 * every Director call 404'd in production while the code looked correct.
 *
 * The fix is a static file per allowlisted vendor path. Nothing in the type
 * system ties the allowlist to the filesystem, so this test does: allowlist a
 * path without adding its route file and the proxy 404s in production only.
 */
const API_DIR = join(import.meta.dirname, 'anthropic')

describe('LLM proxy routes', () => {
  it('has a static route file for every allowlisted vendor path', () => {
    const missing = ALLOWED_LLM_PATHS.filter((path) => !existsSync(join(API_DIR, `${path}.ts`)))
    expect(missing).toEqual([])
  })

  it('uses no dynamic segment, which is what broke the deep paths', () => {
    for (const path of ALLOWED_LLM_PATHS) {
      expect(path).not.toContain('[')
      // a multi-segment path is precisely the case a catch-all could not serve
      expect(existsSync(join(API_DIR, `${path}.ts`))).toBe(true)
    }
  })
})
