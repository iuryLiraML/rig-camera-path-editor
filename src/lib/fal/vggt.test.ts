import { afterEach, describe, expect, it } from 'vitest'
import { configureFal, resetFalForTests, setFalTransportForTests } from './client'
import { VGGT_1B } from './models'
import {
  reconstructViews,
  stillsForVggt,
  VGGT_MAX_POINTS,
  VGGT_MAX_VIEWS,
  vggtPointCloudInput,
} from './vggt'

afterEach(() => {
  resetFalForTests()
})

describe('vggtPointCloudInput', () => {
  it('asks 1b for a point-cloud GLB and no depth or prediction dumps', () => {
    expect(vggtPointCloudInput(['https://a.jpg', 'https://b.jpg'])).toEqual({
      image_urls: ['https://a.jpg', 'https://b.jpg'],
      export_point_cloud: true,
      export_prediction_data: false,
      export_depth_maps: false,
      confidence_percentile: 50,
      max_points: VGGT_MAX_POINTS,
      enable_safety_checker: true,
    })
    expect(vggtPointCloudInput(['https://a.jpg'])).not.toHaveProperty('video_url')
  })

  it('refuses zero URLs and more than the Fal max', () => {
    expect(() => vggtPointCloudInput([])).toThrow(/at least one/)
    expect(() => vggtPointCloudInput(Array.from({ length: 49 }, (_, i) => `https://${i}.jpg`))).toThrow(
      /48/,
    )
  })
})

describe('stillsForVggt', () => {
  it('accepts jpeg png webp up to the Generate cap', () => {
    const files = [
      new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array([1])], 'b.webp', { type: 'image/webp' }),
    ]
    expect(stillsForVggt(files)).toHaveLength(2)
  })

  it('refuses an empty drop, a thirteenth still, and a non-image', () => {
    expect(() => stillsForVggt([])).toThrow(/at least one/)
    const tooMany = Array.from(
      { length: VGGT_MAX_VIEWS + 1 },
      (_, i) => new File([new Uint8Array([1])], `${i}.jpg`, { type: 'image/jpeg' }),
    )
    expect(() => stillsForVggt(tooMany)).toThrow(String(VGGT_MAX_VIEWS))
    expect(() =>
      stillsForVggt([new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' })]),
    ).toThrow(/JPEG, PNG, or WEBP/)
  })
})

describe('reconstructViews', () => {
  it('reads the GLB from point_cloud and never returns estimated cameras', async () => {
    configureFal('key-test')
    const calls: { modelId: string; input: Record<string, unknown> }[] = []
    setFalTransportForTests({
      subscribe: async (modelId, input) => {
        calls.push({ modelId, input })
        return {
          point_cloud: { url: 'https://cloud.glb' },
          num_frames: 2,
          extrinsics: [[[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]],
          intrinsics: [[[518, 0, 259], [0, 518, 259], [0, 0, 1]]],
        }
      },
    })
    const result = await reconstructViews({ imageUrls: ['https://a.jpg', 'https://b.jpg'] })
    expect(calls[0]?.modelId).toBe(VGGT_1B)
    expect(calls[0]?.input).not.toHaveProperty('video_url')
    expect(calls[0]?.input.export_prediction_data).toBe(false)
    expect(calls[0]?.input.export_depth_maps).toBe(false)
    expect(result).toEqual({ glbUrl: 'https://cloud.glb', numFrames: 2 })
    expect(result).not.toHaveProperty('extrinsics')
    expect(result).not.toHaveProperty('intrinsics')
  })

  it('fails when Fal only returns model_glb', async () => {
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async () => ({ model_glb: { url: 'https://mesh.glb' } }),
    })
    await expect(reconstructViews({ imageUrls: ['https://a.jpg'] })).rejects.toThrow(/point-cloud GLB/)
  })
})
