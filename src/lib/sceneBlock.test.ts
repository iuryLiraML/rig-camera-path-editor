import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./fal/client', () => ({
  falUsable: vi.fn(() => true),
  configureFal: vi.fn(),
  uploadImage: vi.fn(async () => 'https://img'),
  uploadFile: vi.fn(async () => 'https://mask/fresh'),
}))

vi.mock('./fal/segment', () => ({
  segmentImageWithFallback: vi.fn(),
}))

vi.mock('./fal/attachment', () => ({
  getLiftAttachment: vi.fn(),
  isVideoFile: () => false,
}))

vi.mock('./fal/samAlign', () => ({
  alignBodyToImage: vi.fn(async () => ({})),
}))

vi.mock('./fal/lift', () => ({
  liftPersonDetailed: vi.fn(),
  liftPropDetailed: vi.fn(),
  downloadGlb: vi.fn(async () => new ArrayBuffer(8)),
}))

vi.mock('./fal/remesh', () => ({
  remeshGlb: vi.fn(async () => 'https://remeshed.glb'),
}))

vi.mock('./glbTriangleCount', () => ({
  countGltfTriangles: vi.fn(() => 12),
}))

vi.mock('./sceneIO', () => ({
  importModelBuffer: vi.fn(),
  RETOPO_TRIANGLES: 80_000,
  FAL_REMESH_MAX_BYTES: 150 * 1024 * 1024,
}))

import { getLiftAttachment } from './fal/attachment'
import { falUsable, uploadFile } from './fal/client'
import { liftPersonDetailed, liftPropDetailed, downloadGlb } from './fal/lift'
import { remeshGlb } from './fal/remesh'
import { countGltfTriangles } from './glbTriangleCount'
import { alignBodyToImage } from './fal/samAlign'
import { importModelBuffer } from './sceneIO'
import { segmentImageWithFallback } from './fal/segment'
import {
  clearSceneBlockSession,
  commitSceneBlock,
  getSceneBlockSession,
  proposeSceneBlockFromAttachment,
  proposeSceneBlockFromFile,
} from './sceneBlock'
import { resetFalJobAborts } from './fal/jobAbort'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { useSceneStore } from '../state/useSceneStore'

function samHits(table: Record<string, string[]>) {
  return async ({ prompt }: { prompt: string }) => {
    const urls = table[prompt] ?? []
    return { maskUrl: urls[0] ?? '', maskUrls: urls, modelId: 'sam' }
  }
}

afterEach(() => {
  clearSceneBlockSession()
  resetFalJobAborts()
  useEnvironmentStore.setState({ findOpen: false, findPlaceMode: 'unplaced', environmentId: null })
  useSceneStore.setState({ notice: null, pendingLifts: [] })
  vi.mocked(falUsable).mockReturnValue(true)
  vi.mocked(liftPersonDetailed).mockReset()
  vi.mocked(liftPropDetailed).mockReset()
  vi.mocked(alignBodyToImage).mockReset()
  vi.mocked(alignBodyToImage).mockResolvedValue({})
  vi.mocked(importModelBuffer).mockReset()
  vi.mocked(remeshGlb).mockReset()
  vi.mocked(remeshGlb).mockResolvedValue('https://remeshed.glb')
  vi.mocked(countGltfTriangles).mockReset()
  vi.mocked(countGltfTriangles).mockReturnValue(12)
  vi.mocked(downloadGlb).mockReset()
  vi.mocked(downloadGlb).mockResolvedValue(new ArrayBuffer(8))
  vi.mocked(uploadFile).mockResolvedValue('https://mask/fresh')
})

describe('proposeSceneBlockFromAttachment', () => {
  it('asks SAM for named scene nouns, not a generic object catch-all', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'room.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(
      samHits({
        person: ['https://mask/person'],
        dog: ['https://mask/dog'],
        table: ['https://mask/table'],
        plant: ['https://mask/plant'],
      }),
    )
    const message = await proposeSceneBlockFromAttachment()
    expect(message).toMatch(/Review the list/)
    const rows = getSceneBlockSession()?.rows ?? []
    expect(rows.map((row) => row.kind)).toEqual(['person', 'animal', 'object', 'object'])
    expect(rows.map((row) => row.name)).toEqual(['Person', 'Dog', 'Table', 'Plant'])
    expect(rows.map((row) => row.maskUrl)).toEqual([
      'https://mask/person',
      'https://mask/dog',
      'https://mask/table',
      'https://mask/plant',
    ])
    const prompts = vi.mocked(segmentImageWithFallback).mock.calls.map((call) => call[0]?.prompt)
    expect(prompts).toContain('person')
    expect(prompts).toContain('dog')
    expect(prompts).toContain('table')
    expect(prompts).toContain('plant')
    expect(prompts.some((prompt) => /exclude/i.test(String(prompt)))).toBe(false)
    expect(useEnvironmentStore.getState().findPlaceMode).toBe('scene')
    expect(useEnvironmentStore.getState().findOpen).toBe(true)
  })

  it('blocks from a Generate still without a chat attachment', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(null)
    vi.mocked(segmentImageWithFallback).mockImplementation(
      samHits({
        person: ['https://mask/person'],
        chair: ['https://mask/chair'],
      }),
    )
    const message = await proposeSceneBlockFromFile(
      new File([new Uint8Array([1])], 'set.jpg', { type: 'image/jpeg' }),
    )
    expect(message).toMatch(/Review the list/)
    expect(getSceneBlockSession()?.rows.map((row) => row.name)).toEqual(['Person', 'Chair'])
    expect(useEnvironmentStore.getState().findPlaceMode).toBe('scene')
  })

  it('drops a second row that reused the same mask URL', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'huddle.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(
      samHits({
        person: ['https://mask/same'],
        dog: ['https://mask/same'],
      }),
    )
    await proposeSceneBlockFromAttachment()
    const rows = getSceneBlockSession()?.rows ?? []
    expect(rows.map((row) => row.kind)).toEqual(['person'])
    expect(rows.map((row) => row.maskUrl)).toEqual(['https://mask/same'])
  })

  it('falls back to a plain object prompt when only a person is found', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'portrait.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(
      samHits({
        person: ['https://mask/person'],
        object: ['https://mask/obj'],
      }),
    )
    await proposeSceneBlockFromAttachment()
    const rows = getSceneBlockSession()?.rows ?? []
    expect(rows.map((row) => row.name)).toEqual(['Person', 'Object'])
    expect(vi.mocked(segmentImageWithFallback).mock.calls.some((call) => call[0]?.prompt === 'object')).toBe(
      true,
    )
  })
})

describe('commitSceneBlock', () => {
  it('fails closed without a live mask session', async () => {
    useEnvironmentStore.setState({ findOpen: true })
    useSceneStore.setState({ notice: null })
    await commitSceneBlock([{ id: 'x', kind: 'object', name: 'Chair' }])
    expect(useSceneStore.getState().notice).toMatch(/Run Block this scene again/)
    expect(useEnvironmentStore.getState().findOpen).toBe(false)
  })

  it('instances clay without generating a palco from the still', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'room.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(samHits({ chair: ['https://mask/chair'] }))
    await proposeSceneBlockFromAttachment()
    const rows = getSceneBlockSession()?.rows ?? []
    useEnvironmentStore.setState({ environmentId: null, findOpen: true })
    vi.mocked(liftPropDetailed).mockResolvedValue({ glbUrl: 'https://chair.glb', metadata: {} })
    vi.mocked(importModelBuffer).mockResolvedValue({
      objectId: 'obj-chair',
      objectName: 'Chair',
      byteSize: 8,
      triangles: 12,
    })
    useSceneStore.setState({ notice: null, objects: [] })
    await commitSceneBlock(rows)
    expect(liftPropDetailed).toHaveBeenCalled()
    expect(importModelBuffer).toHaveBeenCalledWith(
      expect.anything(),
      'Chair',
      expect.objectContaining({ autoRemesh: false, normalize: false, keepDenseMesh: true }),
    )
    expect(useSceneStore.getState().notice).toMatch(/Blocked 1 object/)
    expect(useEnvironmentStore.getState().findOpen).toBe(false)
    expect(getSceneBlockSession()).toBeNull()
  })

  it('lifts a generic Animal row through 3d-objects as dog', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'dog.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(samHits({ dog: ['https://mask/dog'] }))
    await proposeSceneBlockFromAttachment()
    const rows = getSceneBlockSession()?.rows ?? []
    vi.mocked(liftPropDetailed).mockResolvedValue({ glbUrl: 'https://dog.glb', metadata: {} })
    vi.mocked(importModelBuffer).mockResolvedValue({
      objectId: 'obj-dog',
      objectName: 'Animal',
      byteSize: 8,
      triangles: 12,
    })
    await commitSceneBlock(rows)
    expect(vi.mocked(liftPropDetailed).mock.calls[0]?.[0].prompt).toBe('dog')
  })

  it('keeps the panel closed when every lift fails', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'room.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(samHits({ chair: ['https://mask/chair'] }))
    await proposeSceneBlockFromAttachment()
    const rows = getSceneBlockSession()?.rows ?? []
    useEnvironmentStore.setState({ findOpen: true })
    vi.mocked(liftPropDetailed).mockRejectedValue(new Error('lift exploded'))
    useSceneStore.setState({ notice: null })
    await commitSceneBlock(rows)
    expect(useSceneStore.getState().notice).toMatch(/lift exploded/)
    expect(useEnvironmentStore.getState().findOpen).toBe(false)
  })

  it('instances remaining rows when one lift fails', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'room.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(
      samHits({ person: ['https://mask/person'], chair: ['https://mask/chair'] }),
    )
    await proposeSceneBlockFromAttachment()
    const rows = getSceneBlockSession()?.rows ?? []
    vi.mocked(liftPersonDetailed).mockRejectedValue(new Error('body failed'))
    vi.mocked(liftPropDetailed).mockResolvedValue({ glbUrl: 'https://chair.glb', metadata: {} })
    vi.mocked(importModelBuffer).mockResolvedValue({
      objectId: 'obj-chair',
      objectName: 'Chair',
      byteSize: 8,
      triangles: 12,
    })
    useSceneStore.setState({ notice: null, objects: [] })
    await commitSceneBlock(rows)
    expect(liftPropDetailed).toHaveBeenCalled()
    expect(importModelBuffer).toHaveBeenCalledTimes(1)
    expect(useSceneStore.getState().notice).toMatch(/Blocked 1 object/)
    expect(useEnvironmentStore.getState().findOpen).toBe(false)
  })

  it('does not import until every lift has finished', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'room.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(
      samHits({ person: ['https://mask/person'], chair: ['https://mask/chair'] }),
    )
    await proposeSceneBlockFromAttachment()
    const rows = getSceneBlockSession()?.rows ?? []
    let releaseChair: () => void = () => undefined
    const chairHang = new Promise<{ glbUrl: string; metadata: unknown }>((resolve) => {
      releaseChair = () => resolve({ glbUrl: 'https://chair.glb', metadata: {} })
    })
    vi.mocked(liftPersonDetailed).mockResolvedValue({ glbUrl: 'https://person.glb', metadata: {} })
    vi.mocked(liftPropDetailed).mockImplementation(() => chairHang)
    vi.mocked(importModelBuffer).mockImplementation(async (_buffer, name) => ({
      objectId: name === 'Person' ? 'obj-person' : 'obj-chair',
      objectName: String(name),
      byteSize: 8,
      triangles: 12,
    }))
    const done = commitSceneBlock(rows)
    await vi.waitFor(() => expect(liftPropDetailed).toHaveBeenCalled())
    expect(importModelBuffer).not.toHaveBeenCalled()
    releaseChair()
    await done
    expect(importModelBuffer).toHaveBeenCalledTimes(2)
  })

  it('imports the SAM mesh and never remeshes or parks a cube', async () => {
    vi.mocked(countGltfTriangles).mockReturnValue(120_000)
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'room.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(samHits({ chair: ['https://mask/chair'] }))
    await proposeSceneBlockFromAttachment()
    const rows = getSceneBlockSession()?.rows ?? []
    vi.mocked(liftPropDetailed).mockResolvedValue({ glbUrl: 'https://chair.glb', metadata: {} })
    vi.mocked(importModelBuffer).mockResolvedValue({
      objectId: 'obj-chair',
      objectName: 'Chair',
      byteSize: 8,
      triangles: 12,
    })
    await commitSceneBlock(rows)
    expect(remeshGlb).not.toHaveBeenCalled()
    expect(importModelBuffer).toHaveBeenCalledTimes(1)
    expect(importModelBuffer).toHaveBeenCalledWith(
      expect.anything(),
      'Chair',
      expect.objectContaining({ autoRemesh: false, keepDenseMesh: true }),
    )
  })

  it('aligns the person against the first object mesh', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'room.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(
      samHits({ person: ['https://mask/person'], chair: ['https://mask/chair'] }),
    )
    await proposeSceneBlockFromAttachment()
    const rows = getSceneBlockSession()?.rows ?? []
    vi.mocked(liftPersonDetailed).mockResolvedValue({
      glbUrl: 'https://person.glb',
      metadata: { people: [{ focal_length: 1200 }] },
    })
    vi.mocked(liftPropDetailed).mockResolvedValue({ glbUrl: 'https://chair.glb', metadata: {} })
    vi.mocked(importModelBuffer).mockImplementation(async (_buffer, name) => ({
      objectId: name === 'Person' ? 'obj-person' : 'obj-chair',
      objectName: String(name),
      byteSize: 8,
      triangles: 12,
    }))
    await commitSceneBlock(rows)
    expect(alignBodyToImage).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyMeshUrl: 'https://person.glb',
        objectMeshUrl: 'https://chair.glb',
        focalLength: 1200,
      }),
    )
  })

  it('does not call Align when there is no person', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'room.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(samHits({ chair: ['https://mask/chair'] }))
    await proposeSceneBlockFromAttachment()
    const rows = getSceneBlockSession()?.rows ?? []
    vi.mocked(liftPropDetailed).mockResolvedValue({ glbUrl: 'https://chair.glb', metadata: {} })
    vi.mocked(importModelBuffer).mockResolvedValue({
      objectId: 'obj-chair',
      objectName: 'Chair',
      byteSize: 8,
      triangles: 12,
    })
    await commitSceneBlock(rows)
    expect(alignBodyToImage).not.toHaveBeenCalled()
  })

  it('rehosts SAM masks onto Fal storage before confirm', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'room.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(samHits({ chair: ['https://mask/chair'] }))
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === 'https://mask/chair') {
        return new Response(new Uint8Array([9, 9, 9]), { status: 200 })
      }
      throw new Error(`unexpected fetch ${String(input)}`)
    }) as typeof fetch
    try {
      await proposeSceneBlockFromAttachment()
    } finally {
      globalThis.fetch = originalFetch
    }
    const live = getSceneBlockSession()
    expect(uploadFile).toHaveBeenCalled()
    expect(live?.rows[0]?.maskUrl).toBe('https://mask/fresh')
    expect(live?.maskBytes['https://mask/fresh']?.byteLength).toBe(3)
  })

  it('re-uploads a cached mask after a 404 and continues', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'room.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(samHits({ chair: ['https://mask/chair'] }))
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error('rehost blocked')).mockResolvedValue('https://mask/fresh')
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === 'https://mask/chair') {
        return new Response(new Uint8Array([9, 9, 9]), { status: 200 })
      }
      throw new Error(`unexpected fetch ${String(input)}`)
    }) as typeof fetch
    try {
      await proposeSceneBlockFromAttachment()
    } finally {
      globalThis.fetch = originalFetch
    }
    const live = getSceneBlockSession()
    expect(live?.rows[0]?.maskUrl).toBe('https://mask/chair')
    expect(live?.maskBytes['https://mask/chair']?.byteLength).toBe(3)

    vi.mocked(liftPropDetailed)
      .mockRejectedValueOnce(new Error('Fal 404 mask expired'))
      .mockResolvedValueOnce({ glbUrl: 'https://chair.glb', metadata: {} })
    vi.mocked(importModelBuffer).mockResolvedValue({
      objectId: 'obj-chair',
      objectName: 'Chair',
      byteSize: 8,
      triangles: 12,
    })
    useSceneStore.setState({ notice: null, objects: [] })
    await commitSceneBlock(live!.rows)
    expect(uploadFile).toHaveBeenCalled()
    expect(liftPropDetailed).toHaveBeenCalledTimes(2)
    expect(vi.mocked(liftPropDetailed).mock.calls[1]?.[0].maskUrl).toBe('https://mask/fresh')
    expect(useEnvironmentStore.getState().findOpen).toBe(false)
  })
})
