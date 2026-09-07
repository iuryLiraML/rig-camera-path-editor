/**
 * Node 22+ exposes a global `localStorage` that is undefined unless
 * `--localstorage-file` is set. That shadows jsdom's Storage and crashes
 * zustand persist (`localStorage.getItem` on undefined).
 */
const storage = globalThis.localStorage
if (!storage || typeof storage.getItem !== 'function') {
  const fromWindow =
    typeof window !== 'undefined' && window.localStorage && typeof window.localStorage.getItem === 'function'
      ? window.localStorage
      : null
  if (fromWindow) {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fromWindow })
  } else {
    const map = new Map<string, string>()
    const memory: Storage = {
      get length() {
        return map.size
      },
      clear: () => map.clear(),
      getItem: (key) => map.get(key) ?? null,
      key: (index) => [...map.keys()][index] ?? null,
      removeItem: (key) => {
        map.delete(key)
      },
      setItem: (key, value) => {
        map.set(key, String(value))
      },
    }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memory })
  }
}
