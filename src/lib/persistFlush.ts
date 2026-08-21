/**
 * Breaks the projects ↔ scene/rig cycle: key inserts ask for a flush without
 * importing IndexedDB. `watchForAutosave` registers the real saver.
 */
let flusher: (() => void) | null = null

export function setPersistFlusher(fn: (() => void) | null) {
  flusher = fn
}

export function requestPersistFlush() {
  flusher?.()
}
