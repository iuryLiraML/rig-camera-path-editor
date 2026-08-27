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

vi.mock('./environmentJobs', () => ({
  generateEnvironmentFromPhoto: vi.fn(async () => null),
}))

vi.mock('./fal/lift', () => ({
  liftPersonDetailed: vi.fn(),
  liftPropDetailed: vi.fn(),
  downloadGlb: vi.fn(async () => new ArrayBuffer(8)),
}))

vi.mock('./fal/samAlign', () => ({
  alignBodyToImage: vi.fn(async () => ({})),
}))

vi.mock('./sceneIO', () => ({
  importModelBuffer: vi.fn(),
}))

import { getLiftAttachment } from './fal/attachment'
import { falUsable, uploadFile } from './fal/client'
import { generateEnvironmentFromPhoto } from './environmentJobs'
import { liftPersonDetailed, liftPropDetailed } from './fal/lift'
import { segmentImageWithFallback } from './fal/segment'
import {
  clearSceneBlockSession,
  commitSceneBlock,
  getSceneBlockSession,
  proposeSceneBlockFromAttachment,
} from './sceneBlock'
import { resetFalJobAborts } from './fal/jobAbort'
import { useEnvironmentStore } from '../state/useEnvironmentStore'
import { useSceneStore } from '../state/useSceneStore'

afterEach(() => {
  clearSceneBlockSession()
  resetFalJobAborts()
  useEnvironmentStore.setState({ findOpen: false, findPlaceMode: 'unplaced', environmentId: null })
  vi.mocked(falUsable).mockReturnValue(true)
  vi.mocked(generateEnvironmentFromPhoto).mockResolvedValue(null)
  vi.mocked(liftPersonDetailed).mockReset()
  vi.mocked(liftPropDetailed).mockReset()
  vi.mocked(uploadFile).mockResolvedValue('https://mask/fresh')
})

describe('proposeSceneBlockFromAttachment', () => {
  it('keeps SAM mask URLs on the list rows', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'room.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(async ({ prompt }) => {
      if (prompt === 'person') {
        return { maskUrl: 'https://mask/person', maskUrls: ['https://mask/person'], modelId: 'sam' }
      }
      return {
        maskUrl: 'https://mask/obj-1',
        maskUrls: ['https://mask/obj-1', 'https://mask/obj-2'],
        modelId: 'sam',
      }
    })
    const message = await proposeSceneBlockFromAttachment()
    expect(message).toMatch(/Review the list/)
    const rows = getSceneBlockSession()?.rows ?? []
    expect(rows.map((row) => row.maskUrl)).toEqual([
      'https://mask/person',
      'https://mask/obj-1',
      'https://mask/obj-2',
    ])
    expect(useEnvironmentStore.getState().findPlaceMode).toBe('scene')
    expect(useEnvironmentStore.getState().findOpen).toBe(true)
  })
})

describe('commitSceneBlock', () => {
  it('fails closed without a live mask session', async () => {
    useSceneStore.setState({ notice: null })
    await commitSceneBlock([{ id: 'x', kind: 'object', name: 'Chair' }])
    expect(useSceneStore.getState().notice).toMatch(/Run Block this scene again/)
  })

  it('stops if the palco generate fails', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'room.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockResolvedValue({
      maskUrl: 'https://mask/chair',
      maskUrls: ['https://mask/chair'],
      modelId: 'sam',
    })
    await proposeSceneBlockFromAttachment()
    const rows = getSceneBlockSession()?.rows ?? []
    useEnvironmentStore.setState({ environmentId: null })
    useSceneStore.setState({ notice: null })
    await commitSceneBlock(rows)
    expect(useSceneStore.getState().notice).toMatch(/Environment generate failed/)
    expect(liftPropDetailed).not.toHaveBeenCalled()
  })

  it('re-uploads a cached mask after a 404 and continues', async () => {
    vi.mocked(getLiftAttachment).mockReturnValue(
      new File([new Uint8Array([1])], 'room.jpg', { type: 'image/jpeg' }),
    )
    vi.mocked(segmentImageWithFallback).mockImplementation(async ({ prompt }) => {
      if (prompt === 'person') {
        return { maskUrl: '', maskUrls: [], modelId: 'sam' }
      }
      return {
        maskUrl: 'https://mask/chair',
        maskUrls: ['https://mask/chair'],
        modelId: 'sam',
      }
    })
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
    expect(live?.maskBytes['https://mask/chair']?.byteLength).toBe(3)

    useEnvironmentStore.setState({ environmentId: 'env-1' })
    vi.mocked(liftPropDetailed)
      .mockRejectedValueOnce(new Error('Fal 404 mask expired'))
      .mockResolvedValueOnce({ glbUrl: 'https://chair.glb', metadata: {} })
    useSceneStore.setState({ notice: null, objects: [] })
    await commitSceneBlock(live!.rows)
    expect(uploadFile).toHaveBeenCalled()
    expect(liftPropDetailed).toHaveBeenCalledTimes(2)
    expect(vi.mocked(liftPropDetailed).mock.calls[1]?.[0].maskUrl).toBe('https://mask/fresh')
  })
})
