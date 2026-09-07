import { describe, expect, it } from 'vitest'
import { ensureStores, STORES } from './idb'

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
    expect(created).toEqual([STORES.folders, STORES.assetThumbs])
    expect(names.has(STORES.folders)).toBe(true)
    expect(names.has(STORES.assetThumbs)).toBe(true)
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
    expect(created).toEqual([STORES.assetThumbs])
  })
})
