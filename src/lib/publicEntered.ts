/** Public app: the visitor skipped Welcome or signed in on this origin. */
export const PUBLIC_ENTERED_KEY = 'rig-public-entered'

const listeners = new Set<() => void>()

function readFlag(): boolean {
  try {
    return localStorage.getItem(PUBLIC_ENTERED_KEY) === '1'
  } catch {
    return false
  }
}

let current = readFlag()

function emit() {
  current = true
  for (const listener of listeners) listener()
}

export function hasPublicEntered(): boolean {
  return current || readFlag()
}

export function markPublicEntered(): void {
  try {
    localStorage.setItem(PUBLIC_ENTERED_KEY, '1')
  } catch {
    /* private mode */
  }
  emit()
}

export function subscribePublicEntered(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
