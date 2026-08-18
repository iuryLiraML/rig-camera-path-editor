/**
 * OrbitControls must stay off for the whole pick/drag gesture.
 *
 * `bindOrbitToPane` used to set `controls.enabled = true` on every pointer
 * move and every frame. Clicking a mesh selected it *and* started an orbit
 * on the same down, so you could not pick without moving the camera.
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

/** Tests / emergency reset — not for production gesture code. */
export function resetOrbitLock() {
  locks = 0
}
