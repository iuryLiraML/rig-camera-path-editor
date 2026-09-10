import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureStores, STORES } from './idb'

const ALL_STORES: string[] = Object.values(STORES)

function fakeDb(version: number, names: Set<string>) {
  return {
    version,
    objectStoreNames: { contains: (name: string) => names.has(name) },
    createObjectStore: (name: string) => {
      names.add(name)
    },
    close: () => {},
    onversionchange: null as null | (() => void),
  }
}

type FakeRequest = {
  result?: ReturnType<typeof fakeDb>
  onupgradeneeded?: () => void
  onsuccess?: () => void
  onerror?: () => void
  readonly error: Error
}

/** Minimal indexedDB stub: the origin already has rig-db at `existingVersion` with `names` stores. */
function stubIndexedDB(existingVersion: number, names: Set<string>) {
  const opens: (number | undefined)[] = []
  vi.stubGlobal('indexedDB', {
    open: (_name: string, version?: number) => {
      opens.push(version)
      const req: FakeRequest = {
        error: Object.assign(new Error('VersionError'), { name: 'VersionError' }),
      }
      queueMicrotask(() => {
        if (version !== undefined && version < existingVersion) {
          req.onerror?.()
          return
        }
        if (version !== undefined && version > existingVersion) {
          existingVersion = version
          req.result = fakeDb(version, names)
          req.onupgradeneeded?.()
        } else {
          req.result = fakeDb(existingVersion, names)
        }
        req.onsuccess?.()
      })
      return req
    },
  })
  return opens
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('openDB version recovery', () => {
  it('opens at the existing version when the origin database is newer than the schema', async () => {
    stubIndexedDB(13, new Set(ALL_STORES))
    const { openDB } = await import('./idb')
    const db = await openDB()
    expect(db.version).toBe(13)
  })

  it('ratchets up and creates missing stores when the newer database lacks one', async () => {
    const names: Set<string> = new Set(ALL_STORES.filter((store) => store !== STORES.library))
    const opens = stubIndexedDB(13, names)
    const { openDB } = await import('./idb')
    const db = await openDB()
    expect(db.version).toBe(14)
    expect(names.has(STORES.library)).toBe(true)
    expect(opens).toEqual([8, undefined, 14])
  })
})

describe('ensureStores', () => {
  it('creates the folders store when a v3 database only has projects and buffers', () => {
    const created: string[] = []
    const names = new Set(['model-buffers', 'projects'])
    ensureStores({
      objectStoreNames: { contains: (name) => names.has(name) },
      createObjectStore: (name) => {
        created.push(name)
        names.add(name)
        return undefined
      },
    })
    expect(created).toEqual([STORES.folders, STORES.assetThumbs, STORES.library, STORES.collections, STORES.productionMedia, STORES.productionJobs])
    expect(names.has(STORES.folders)).toBe(true)
    expect(names.has(STORES.assetThumbs)).toBe(true)
    expect(names.has(STORES.library)).toBe(true)
  })

  it('creates the asset-thumbs store when a v4 database already has folders', () => {
    const created: string[] = []
    const names = new Set(['model-buffers', 'projects', 'folders'])
    ensureStores({
      objectStoreNames: { contains: (name) => names.has(name) },
      createObjectStore: (name) => {
        created.push(name)
        names.add(name)
        return undefined
      },
    })
    expect(created).toEqual([STORES.assetThumbs, STORES.library, STORES.collections, STORES.productionMedia, STORES.productionJobs])
  })

  it('creates the library store when a v5 database already has asset thumbs', () => {
    const created: string[] = []
    const names = new Set(['model-buffers', 'projects', 'folders', 'asset-thumbs'])
    ensureStores({
      objectStoreNames: { contains: (name) => names.has(name) },
      createObjectStore: (name) => {
        created.push(name)
        names.add(name)
        return undefined
      },
    })
    expect(created).toEqual([STORES.library, STORES.collections, STORES.productionMedia, STORES.productionJobs])
  })

  it('creates the collections store when a v6 database already has the library', () => {
    const created: string[] = []
    const names = new Set(ALL_STORES.filter((store) => store !== STORES.collections))
    ensureStores({
      objectStoreNames: { contains: (name) => names.has(name) },
      createObjectStore: (name) => {
        created.push(name)
        names.add(name)
        return undefined
      },
    })
    expect(created).toEqual([STORES.collections])
  })
})
