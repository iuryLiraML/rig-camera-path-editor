/** Shared IndexedDB access — one database, versioned stores. */

const DB_NAME = 'rig-db'
/** v4: folders store. v3 shipped in some sessions without creating it. */
const DB_VERSION = 4

export const STORES = {
  buffers: 'model-buffers',
  projects: 'projects',
  folders: 'folders',
} as const

let dbPromise: Promise<IDBDatabase> | null = null

export function ensureStores(db: {
  objectStoreNames: { contains: (name: string) => boolean }
  createObjectStore: (name: string, options?: IDBObjectStoreParameters) => unknown
}) {
  if (!db.objectStoreNames.contains(STORES.buffers)) db.createObjectStore(STORES.buffers)
  if (!db.objectStoreNames.contains(STORES.projects)) {
    db.createObjectStore(STORES.projects, { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains(STORES.folders)) {
    db.createObjectStore(STORES.folders, { keyPath: 'id' })
  }
}

function storesReady(db: { objectStoreNames: { contains: (name: string) => boolean } }) {
  return Object.values(STORES).every((store) => db.objectStoreNames.contains(store))
}

function openWithVersion(version: number, attempts = 0): Promise<IDBDatabase> {
  if (attempts > 8) {
    return Promise.reject(new Error('IndexedDB is missing required stores'))
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version)
    req.onupgradeneeded = () => ensureStores(req.result)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => db.close()
      if (storesReady(db)) {
        resolve(db)
        return
      }
      db.close()
      openWithVersion(db.version + 1, attempts + 1).then(resolve, reject)
    }
  })
}

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = openWithVersion(DB_VERSION)
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

export async function idbPut(store: string, value: unknown, key?: string) {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value as never, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

export async function idbDelete(store: string, key: string) {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function idbClear(): Promise<void> {
  const db = await openDB()
  await Promise.all(
    Object.values(STORES).map(
      (store) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(store, 'readwrite')
          tx.objectStore(store).clear()
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }),
    ),
  )
}

export async function idbKeys(store: string): Promise<string[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAllKeys()
    req.onsuccess = () => resolve(req.result as string[])
    req.onerror = () => reject(req.error)
  })
}
