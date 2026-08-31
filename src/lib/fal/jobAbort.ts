/** Hung Fal 3D jobs (TripoSplat / SAM Body / 3d-objects) can sit in queue for minutes. */
export const FAL_3D_JOB_TIMEOUT_MS = 10 * 60 * 1000

const controllers = new Map<string, AbortController>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

export function startFalJobAbort(
  liftId: string,
  timeoutMs: number = FAL_3D_JOB_TIMEOUT_MS,
): AbortSignal {
  finishFalJobAbort(liftId)
  const controller = new AbortController()
  controllers.set(liftId, controller)
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  const handle = timer as { unref?: () => void }
  handle.unref?.()
  timers.set(liftId, timer)
  return controller.signal
}

export function cancelFalJob(liftId: string) {
  controllers.get(liftId)?.abort()
}

/** Keep one cancel handle, but give the next sequential Fal call a fresh hang window. */
export function bumpFalJobTimeout(liftId: string, timeoutMs: number = FAL_3D_JOB_TIMEOUT_MS) {
  const controller = controllers.get(liftId)
  if (!controller || controller.signal.aborted) return
  const existing = timers.get(liftId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  const handle = timer as { unref?: () => void }
  handle.unref?.()
  timers.set(liftId, timer)
}

export function finishFalJobAbort(liftId: string) {
  const timer = timers.get(liftId)
  if (timer) clearTimeout(timer)
  timers.delete(liftId)
  controllers.delete(liftId)
}

export function resetFalJobAborts() {
  for (const timer of timers.values()) clearTimeout(timer)
  for (const controller of controllers.values()) controller.abort()
  timers.clear()
  controllers.clear()
}

export function isFalAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  const message = 'message' in error ? String(error.message) : ''
  return name === 'AbortError' || /abort/i.test(message)
}

export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const handle = timer as { unref?: () => void }
  handle.unref?.()
  return controller.signal
}

export function combineAbortSignals(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal | undefined {
  const live = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (live.length === 0) return undefined
  if (live.length === 1) return live[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(live)
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  for (const signal of live) {
    if (signal.aborted) {
      controller.abort()
      return controller.signal
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }
  return controller.signal
}
