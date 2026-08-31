/** First remesh before we have local history. Tripo usually lands in 1–2 min. */
export const DEFAULT_REMESH_MS = 90_000
const MIN_EXPECTED_MS = 30_000
const MAX_EXPECTED_MS = 180_000
const MAX_SAMPLES = 8
const STORAGE_KEY = 'rig:remesh-durations'

/** Cap the fill so a late job never looks finished. */
export const REMESH_BAR_CAP = 0.96

export function expectedRemeshMs(samples: number[]): number {
  if (samples.length === 0) return DEFAULT_REMESH_MS
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
  if (!Number.isFinite(mean) || mean <= 0) return DEFAULT_REMESH_MS
  return Math.min(MAX_EXPECTED_MS, Math.max(MIN_EXPECTED_MS, Math.round(mean)))
}

export function remeshTimeProgress(elapsedMs: number, expectedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0
  if (!Number.isFinite(expectedMs) || expectedMs <= 0) return 0
  return Math.min(REMESH_BAR_CAP, elapsedMs / expectedMs)
}

/** Prefer a real Fal fraction when it is ahead of the clock estimate. */
export function remeshBarFraction(elapsedMs: number, expectedMs: number, falProgress: number | null): number {
  const timed = remeshTimeProgress(elapsedMs, expectedMs)
  if (falProgress == null || !Number.isFinite(falProgress)) return timed
  return Math.min(REMESH_BAR_CAP, Math.max(timed, Math.max(0, falProgress)))
}

export function formatRemeshClock(ms: number): string {
  const clamped = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(clamped / 60)
  const seconds = clamped % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function remeshEtaCopy(
  remainingMs: number,
  expectedMs: number,
  overtime: boolean,
): string {
  const typical = formatRemeshClock(expectedMs)
  if (overtime) return `Taking longer than usual · typically ${typical}`
  if (remainingMs <= 8_000) return `Finishing… · typically ${typical}`
  return `${formatRemeshClock(remainingMs)} left · typically ${typical}`
}

export function remeshBarState(opts: {
  startedAt: number
  now: number
  expectedMs: number
  falProgress: number | null
}): { fraction: number; remainingMs: number; elapsedMs: number; overtime: boolean; label: string } {
  const elapsedMs = Math.max(0, opts.now - opts.startedAt)
  const remainingMs = Math.max(0, opts.expectedMs - elapsedMs)
  const overtime = elapsedMs >= opts.expectedMs
  const fraction = remeshBarFraction(elapsedMs, opts.expectedMs, opts.falProgress)
  return {
    fraction,
    remainingMs,
    elapsedMs,
    overtime,
    label: remeshEtaCopy(remainingMs, opts.expectedMs, overtime),
  }
}

let memorySamples: number[] = []

function readSamples(): number[] {
  if (typeof localStorage === 'undefined') return memorySamples
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return memorySamples
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return memorySamples
    return parsed.filter((value): value is number => typeof value === 'number' && value > 0)
  } catch {
    return memorySamples
  }
}

function writeSamples(samples: number[]) {
  memorySamples = samples.slice(-MAX_SAMPLES)
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memorySamples))
  } catch {
    /* private mode */
  }
}

export function liveExpectedRemeshMs(): number {
  return expectedRemeshMs(readSamples())
}

export function recordRemeshDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 4_000) return
  const next = [...readSamples(), Math.round(durationMs)]
  writeSamples(next)
}

export function resetRemeshEtaForTests() {
  memorySamples = []
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* private mode */
  }
}
