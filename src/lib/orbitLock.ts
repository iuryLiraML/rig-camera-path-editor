/**
 * OrbitControls must stay off for the whole pick/drag gesture.
 *
 * `bindOrbitToPane` used to set `controls.enabled = true` on every pointer
 * move and every frame. Clicking a mesh selected it *and* started an orbit
 * on the same down, so you could not pick without moving the camera.
 *
 * The counter must never outlive the gesture. Draw used to leak a lock
 * (pointer captured, pointerup never unlocked) so Esc / workspace change
 * left the viewport frozen — they do not touch this module.
 */

let locks = 0

export function lockOrbit() {
  locks += 1
}

export function unlockOrbit() {
  locks = Math.max(0, locks - 1)
}

export function isOrbitLocked(): boolean {
  return locks > 0
}

/** Tests / emergency reset — also used to recover a leaked Draw/Pen gesture. */
export function resetOrbitLock() {
  locks = 0
}

type OrbitGesture = {
  enabled?: boolean
  state?: number
  _pointers?: unknown[]
  pointers?: unknown[]
}

/**
 * Clear a leaked lock and abort any half-finished OrbitControls gesture.
 * Safe to call without a controls handle (Esc / workspace switch).
 * Does not dispatch pointer events — that would re-commit a live Draw stroke.
 */
export function restoreViewportNav(controls?: OrbitGesture | null) {
  resetOrbitLock()
  if (!controls) return
  controls.enabled = true
  if (typeof controls.state === 'number') controls.state = -1
  const extra = controls as OrbitGesture & { _state?: number }
  if (typeof extra._state === 'number') extra._state = -1
  if (Array.isArray(controls._pointers)) controls._pointers.length = 0
  if (Array.isArray(controls.pointers)) controls.pointers.length = 0
}
