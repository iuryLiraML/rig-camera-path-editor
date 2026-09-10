/** Shared IndexedDB access — one database, versioned stores. */

const DB_NAME = 'rig-db'
/** v7: Library collections. v6: Account Library assets. v5: asset clay thumbs. v4: folders. */
const DB_VERSION = 8

export const STORES = {
  buffers: 'model-buffers',
  projects: 'projects',
  folders: 'folders',
  assetThumbs: 'asset-thumbs',
  library: 'library-palcos',
  collections: 'library-collections',
  productionMedia: 'production-media',
  productionJobs: 'production-jobs',
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
  if (!db.objectStoreNames.contains(STORES.assetThumbs)) db.createObjectStore(STORES.assetThumbs)
  if (!db.objectStoreNames.contains(STORES.library)) {
    db.createObjectStore(STORES.library, { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains(STORES.collections)) {
    db.createObjectStore(STORES.collections, { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains(STORES.productionMedia)) db.createObjectStore(STORES.productionMedia)
  if (!db.objectStoreNames.contains(STORES.productionJobs)) db.createObjectStore(STORES.productionJobs, { keyPath: 'id' })
}

function storesReady(db: { objectStoreNames: { contains: (name: string) => boolean } }) {
  return Object.values(STORES).every((store) => db.objectStoreNames.contains(store))
}

function openWithVersion(version: number | undefined, attempts = 0): Promise<IDBDatabase> {
  if (attempts > 8) {
    return Promise.reject(new Error('IndexedDB is missing required stores'))
  }
  return new Promise((resolve, reject) => {
    const req = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version)
    req.onupgradeneeded = () => ensureStores(req.result)
    req.onerror = () => {
      // Another clone on this origin may already have bumped the database past
      // our schema version. Reopen at whatever version exists — the stores
      // check below ratchets up only if something we need is actually missing.
      if (req.error?.name === 'VersionError') {
        openWithVersion(undefined, attempts + 1).then(resolve, reject)
        return
      }
      reject(req.error)
    }
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

/** Read and merge in one transaction, including writes from other tabs. Missing records stay deleted. */
export async function idbUpdate<T>(store: string, key: string, update: (current: T) => T): Promise<T | undefined> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const objectStore = tx.objectStore(store)
    const request = objectStore.get(key)
    let result: T | undefined
    request.onsuccess = () => {
      if (request.result === undefined) return
      try {
        result = update(request.result as T)
        objectStore.put(result as never)
      } catch (error) {
        tx.abort()
        reject(error)
      }
    }
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Project update aborted'))
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

export async function idbClear(options?: { keepStores?: readonly string[] }): Promise<void> {
  const db = await openDB()
  const keep = new Set(options?.keepStores ?? [])
  await Promise.all(
    Object.values(STORES)
      .filter((store) => !keep.has(store))
      .map(
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

/** Public sign-out: wipe projects, keep Account Library palcos and their splat bytes. */
export async function idbClearPreservingLibrary(): Promise<void> {
  const palcos = await idbGetAll<{ bufferKey: string }>(STORES.library)
  const keepBuffers = new Set(palcos.map((item) => item.bufferKey).filter(Boolean))
  await idbClear({ keepStores: [STORES.library, STORES.buffers] })
  const keys = await idbKeys(STORES.buffers)
  await Promise.all(keys.filter((key) => !keepBuffers.has(key)).map((key) => idbDelete(STORES.buffers, key)))
}

export async function idbKeys(store: string): Promise<string[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAllKeys()
    req.onsuccess = () => resolve(req.result as string[])
    req.onerror = () => reject(req.error)
  })
}
