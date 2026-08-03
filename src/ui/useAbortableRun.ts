import { useCallback, useRef } from 'react'

export type RunOutcome<T> =
  | { ok: true; value: T }
  /** the user cancelled, or the timeout fired — the caller already has its message */
  | { ok: false; reason: 'aborted' | 'timeout' }
  | { ok: false; reason: 'error'; error: unknown }

/** A request that has not answered by now is treated as failed, not as pending. */
export const DEFAULT_TASK_TIMEOUT_MS = 90_000

/**
 * Runs one cancellable async task at a time, with a timeout.
 *
 * Without this, a hung provider request left every control on the step disabled
 * with no way out but reloading the page: the generators all accept an
 * AbortSignal, but nothing ever passed one.
 */
export function useAbortableRun(timeoutMs: number = DEFAULT_TASK_TIMEOUT_MS) {
  const controllerRef = useRef<AbortController | null>(null)

  const run = useCallback(
    async <T>(task: (signal: AbortSignal) => Promise<T>): Promise<RunOutcome<T>> => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller

      let timedOut = false
      const timer = window.setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)

      try {
        const value = await task(controller.signal)
        if (controller.signal.aborted) {
          return { ok: false, reason: timedOut ? 'timeout' : 'aborted' }
        }
        return { ok: true, value }
      } catch (error) {
        if (controller.signal.aborted) {
          return { ok: false, reason: timedOut ? 'timeout' : 'aborted' }
        }
        return { ok: false, reason: 'error', error }
      } finally {
        window.clearTimeout(timer)
        if (controllerRef.current === controller) controllerRef.current = null
      }
    },
    [timeoutMs],
  )

  /** Abandon the in-flight task; the caller frees its own UI state. */
  const cancel = useCallback(() => {
    const controller = controllerRef.current
    if (!controller) return false
    controllerRef.current = null
    controller.abort()
    return true
  }, [])

  return { run, cancel }
}
