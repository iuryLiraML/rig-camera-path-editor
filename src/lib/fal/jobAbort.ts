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
