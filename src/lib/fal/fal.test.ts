import { afterEach, describe, expect, it } from 'vitest'
import { consumeLiftAttachment, getLiftAttachment, setLiftAttachment } from './attachment'
import { configureFal, resetFalForTests, setFalTransportForTests } from './client'
import { requireModelGlb } from './files'
import { generateFromImage, generateFromText } from './generate3d'
import { liftPerson, liftPersonDetailed, liftProp } from './lift'
import {
  GENERATE_FACE_LIMIT,
  MESHY_TARGET_POLYCOUNT,
  MESHY_V7_IMAGE_TO_3D,
  SAM_3D_BODY,
  SAM_3D_OBJECTS,
  SAM_IMAGE_MODELS,
  TRIPO_H31_TEXT_TO_3D,
  TRIPO_REMESH,
} from './models'
import { liftAttachedStill, runMaskThenLift } from './pipeline'
import { remeshGlb } from './remesh'
import { segmentImage, segmentImageWithFallback } from './segment'

afterEach(() => {
  resetFalForTests()
  consumeLiftAttachment()
})

describe('segmentImage', () => {
  it('always sends an explicit prompt and the versioned model id', async () => {
    const calls: { modelId: string; input: Record<string, unknown> }[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (modelId, input) => {
        calls.push({ modelId, input })
        return { masks: [{ url: 'https://cdn.example/mask.png' }], scores: [0.9] }
      },
    })

    const result = await segmentImage({
      version: '3.1',
      imageUrl: 'data:image/png;base64,xx',
      prompt: 'person',
    })

    expect(result.maskUrl).toBe('https://cdn.example/mask.png')
    expect(result.maskUrls).toEqual(['https://cdn.example/mask.png'])
    expect(calls[0]?.modelId).toBe(SAM_IMAGE_MODELS['3.1'])
    expect(calls[0]?.input.prompt).toBe('person')
    expect(calls[0]?.input.image_url).toBe('data:image/png;base64,xx')
    expect(calls[0]?.input.apply_mask).toBe(false)
    expect(calls[0]?.input.return_multiple_masks).toBe(true)
    expect(calls[0]?.input.max_masks).toBe(8)
    expect(calls[0]?.input.include_boxes).toBe(true)
  })

  it('returns every SAM mask, not only the first person', async () => {
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async () => ({
        masks: [{ url: 'https://a' }, { url: 'https://b' }, { url: 'https://c' }],
      }),
    })
    const result = await segmentImage({
      version: '3.1',
      imageUrl: 'https://photo',
      prompt: 'person',
    })
    expect(result.maskUrl).toBe('https://a')
    expect(result.maskUrls).toEqual(['https://a', 'https://b', 'https://c'])
  })

  it('does not call Fal when the abort signal is already aborted', async () => {
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async () => {
        throw new Error('should not subscribe')
      },
    })
    const controller = new AbortController()
    controller.abort()
    await expect(
      segmentImage({
        version: '3.1',
        imageUrl: 'https://photo',
        prompt: 'person',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses to call Fal without a prompt (default is wheel)', async () => {
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async () => {
        throw new Error('should not subscribe')
      },
    })
    await expect(
      segmentImage({ version: '3.0', imageUrl: 'https://x', prompt: '   ' }),
    ).rejects.toThrow(/explicit prompt/)
  })

  it('falls back from 3.1 to 3.0 on failure', async () => {
    const models: string[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (modelId) => {
        models.push(modelId)
        if (modelId === SAM_IMAGE_MODELS['3.1']) throw new Error('3.1 down')
        return { masks: [{ url: 'https://cdn.example/mask-30.png' }] }
      },
    })

    const result = await segmentImageWithFallback({
      imageUrl: 'https://photo',
      prompt: 'person',
    })
    expect(models).toEqual([SAM_IMAGE_MODELS['3.1'], SAM_IMAGE_MODELS['3.0']])
    expect(result.maskUrl).toBe('https://cdn.example/mask-30.png')
    expect(result.modelId).toBe(SAM_IMAGE_MODELS['3.0'])
  })
})

describe('lift', () => {
  it('sends mask_url to 3d-body and mask_urls to 3d-objects', async () => {
    const calls: { modelId: string; input: Record<string, unknown> }[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (modelId, input) => {
        calls.push({ modelId, input })
        return { model_glb: { url: `https://cdn.example/${modelId}.glb` } }
      },
    })

    await expect(
      liftPerson({ imageUrl: 'https://photo', maskUrl: 'https://mask' }),
    ).resolves.toBe(`https://cdn.example/${SAM_3D_BODY}.glb`)
    await expect(
      liftProp({ imageUrl: 'https://photo', maskUrl: 'https://mask', prompt: 'helmet' }),
    ).resolves.toBe(`https://cdn.example/${SAM_3D_OBJECTS}.glb`)

    expect(calls[0]).toEqual({
      modelId: SAM_3D_BODY,
      input: {
        image_url: 'https://photo',
        mask_url: 'https://mask',
        export_meshes: true,
        include_3d_keypoints: false,
        include_mhr_params: false,
      },
    })
    expect(calls[1]).toEqual({
      modelId: SAM_3D_OBJECTS,
      input: { image_url: 'https://photo', mask_urls: ['https://mask'], prompt: 'helmet' },
    })
  })

  it('omits mask_url so 3d-body can detect every person in a group photo', async () => {
    const calls: Record<string, unknown>[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (_modelId, input) => {
        calls.push(input)
        return { model_glb: { url: 'https://cdn.example/group.glb' } }
      },
    })
    await expect(liftPerson({ imageUrl: 'https://photo' })).resolves.toBe(
      'https://cdn.example/group.glb',
    )
    expect(calls[0]).toEqual({
      image_url: 'https://photo',
      export_meshes: true,
      include_3d_keypoints: false,
      include_mhr_params: false,
    })
  })

  it('requests MHR params only on the video path', async () => {
    const calls: Record<string, unknown>[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (_modelId, input) => {
        calls.push(input)
        return {
          model_glb: { url: 'https://cdn.example/mhr.glb' },
          metadata: { people: [{ body_pose_params: [[0, 0, 0]] }] },
        }
      },
    })
    await liftPersonDetailed({ imageUrl: 'https://photo', includeMhrParams: true })
    expect(calls[0]).toMatchObject({ include_mhr_params: true })
  })
})

describe('runMaskThenLift', () => {
  it('masks with 3.1 then lifts the person through 3d-body', async () => {
    const calls: string[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (modelId, input) => {
        calls.push(modelId)
        if (modelId === SAM_IMAGE_MODELS['3.1']) {
          expect(input.prompt).toBe('person')
          return { masks: [{ url: 'https://mask' }] }
        }
        expect(input.mask_url).toBe('https://mask')
        return { model_glb: { url: 'https://person.glb' } }
      },
    })

    const result = await runMaskThenLift({
      kind: 'person',
      prompt: 'person',
      imageUrl: 'https://photo',
    })
    expect(result.glbUrls).toEqual(['https://person.glb'])
    expect(result.maskCount).toBe(1)
    expect(calls).toEqual([SAM_IMAGE_MODELS['3.1'], SAM_3D_BODY])
  })

  it('lifts each SAM person mask as its own 3d-body GLB', async () => {
    const bodyMasks: unknown[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (modelId, input) => {
        if (modelId === SAM_IMAGE_MODELS['3.1']) {
          return {
            masks: [
              { url: 'https://mask-a' },
              { url: 'https://mask-b' },
              { url: 'https://mask-c' },
            ],
          }
        }
        bodyMasks.push(input.mask_url)
        return { model_glb: { url: `https://person-${bodyMasks.length}.glb` } }
      },
    })

    const result = await runMaskThenLift({
      kind: 'person',
      prompt: 'person',
      imageUrl: 'https://photo',
    })
    expect(result.glbUrls).toEqual([
      'https://person-1.glb',
      'https://person-2.glb',
      'https://person-3.glb',
    ])
    expect(result.maskCount).toBe(3)
    expect(bodyMasks).toEqual(['https://mask-a', 'https://mask-b', 'https://mask-c'])
  })
})

describe('liftAttachedStill', () => {
  it('fails closed without a Fal key or attachment', async () => {
    const importBuffer = async () => {
      throw new Error('should not import')
    }
    await expect(
      liftAttachedStill({
        kind: 'person',
        prompt: 'person',
        falKey: '',
        importBuffer,
        beginLift: () => 'x',
        endLift: () => undefined,
      }),
    ).resolves.toMatch(/Fal API key/)

    await expect(
      liftAttachedStill({
        kind: 'person',
        prompt: 'person',
        falKey: 'key-test',
        importBuffer,
        beginLift: () => 'x',
        endLift: () => undefined,
      }),
    ).resolves.toMatch(/Attach a photo/)

    setLiftAttachment(new File([new Uint8Array([9])], 'take.mp4', { type: 'video/mp4' }))
    await expect(
      liftAttachedStill({
        kind: 'person',
        prompt: 'person',
        falKey: 'key-test',
        importBuffer,
        beginLift: () => 'x',
        endLift: () => undefined,
      }),
    ).resolves.toMatch(/still/)
  })

  it('uploads, lifts, imports, and keeps the photo so SAM can run again', async () => {
    configureFal('key-test')
    setFalTransportForTests({
      upload: async () => 'https://uploaded',
      subscribe: async (modelId) => {
        if (modelId === SAM_IMAGE_MODELS['3.1']) return { masks: [{ url: 'https://mask' }] }
        return { model_glb: { url: 'https://prop.glb' } }
      },
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === 'https://prop.glb') {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      }
      throw new Error(`unexpected fetch ${String(input)}`)
    }) as typeof fetch

    setLiftAttachment(new File([new Uint8Array([9])], 'helmet.jpg', { type: 'image/jpeg' }))
    const ended: string[] = []
    try {
      const message = await liftAttachedStill({
        kind: 'prop',
        prompt: 'helmet',
        falKey: 'key-test',
        importBuffer: async (_buffer, name) => ({ objectId: 'obj-1', objectName: name }),
        beginLift: (name) => {
          expect(name).toContain('Lifting')
          return 'lift-1'
        },
        endLift: (id) => ended.push(id),
      })
      expect(message).toContain('obj-1')
      expect(message).toContain('pose_object')
      expect(ended).toEqual(['lift-1'])
      expect(getLiftAttachment()?.name).toBe('helmet.jpg')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('imports each person as its own object and replaces the previous group', async () => {
    configureFal('key-test')
    setFalTransportForTests({
      upload: async () => 'https://uploaded',
      subscribe: async (modelId) => {
        if (modelId === SAM_IMAGE_MODELS['3.1']) {
          return { masks: [{ url: 'https://a' }, { url: 'https://b' }] }
        }
        return { model_glb: { url: 'https://people.glb' } }
      },
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === 'https://people.glb') {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
      }
      throw new Error(`unexpected fetch ${String(input)}`)
    }) as typeof fetch

    setLiftAttachment(new File([new Uint8Array([9])], 'group.png', { type: 'image/png' }))
    const replaced: string[] = []
    const placed: { id: string; position: [number, number, number] }[] = []
    let n = 0
    const lift = () =>
      liftAttachedStill({
        kind: 'person',
        prompt: 'person',
        falKey: 'key-test',
        importBuffer: async (_buffer, name) => ({ objectId: `p-${++n}`, objectName: name }),
        beginLift: () => 'lift',
        endLift: () => undefined,
        replacePrevious: (id) => replaced.push(id),
        placeObject: (id, position) => placed.push({ id, position }),
      })
    try {
      const first = await lift()
      expect(first).toContain('Person 1')
      expect(first).toContain('Person 2')
      expect(first).toContain('p-1')
      expect(first).toContain('p-2')
      expect(placed).toEqual([
        { id: 'p-1', position: [-0.9, 0, 0] },
        { id: 'p-2', position: [0.9, 0, 0] },
      ])
      await lift()
      expect(replaced).toEqual(['p-1', 'p-2'])
      expect(getLiftAttachment()?.name).toBe('group.png')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('block video attachments', () => {
  it('block_people_from_image refuses when a video is attached', async () => {
    setLiftAttachment(new File([new Uint8Array([9])], 'take.mp4', { type: 'video/mp4' }))
    await expect(
      liftAttachedStill({
        kind: 'person',
        prompt: 'person',
        falKey: 'key-test',
        importBuffer: async () => {
          throw new Error('should not import')
        },
        beginLift: () => 'x',
        endLift: () => undefined,
      }),
    ).resolves.toMatch(/Attach a photo/)
  })
})

describe('requireModelGlb', () => {
  it('accepts Tripo model_mesh and Meshy model_glb', () => {
    expect(requireModelGlb({ model_mesh: { url: 'https://a.glb' } }, 'tripo')).toBe('https://a.glb')
    expect(requireModelGlb({ model_glb: { url: 'https://b.glb' } }, 'meshy')).toBe('https://b.glb')
  })

  it('rejects FBX even when a url is present', () => {
    expect(() =>
      requireModelGlb({ model_mesh: { url: 'https://a.fbx', file_name: 'out.fbx' } }, 'tripo'),
    ).toThrow(/FBX/)
  })
})

describe('generateFromText', () => {
  it('calls Tripo H3.1 without textures and with the clay face cap', async () => {
    const calls: { modelId: string; input: Record<string, unknown> }[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (modelId, input) => {
        calls.push({ modelId, input })
        return { model_mesh: { url: 'https://house.glb' } }
      },
    })
    await expect(generateFromText({ prompt: 'a clay house' })).resolves.toBe('https://house.glb')
    expect(calls[0]?.modelId).toBe(TRIPO_H31_TEXT_TO_3D)
    expect(calls[0]?.input).toMatchObject({
      prompt: 'a clay house',
      texture: false,
      pbr: false,
      face_limit: GENERATE_FACE_LIMIT,
    })
  })

  it('does not call Fal when the abort signal is already aborted', async () => {
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async () => {
        throw new Error('should not subscribe')
      },
    })
    const controller = new AbortController()
    controller.abort()
    await expect(generateFromText({ prompt: 'a clay house', signal: controller.signal })).rejects.toMatchObject(
      { name: 'AbortError' },
    )
  })
})

describe('generateFromImage', () => {
  it('calls Meshy v7 without texture or PBR and remeshes to triangles', async () => {
    const calls: { modelId: string; input: Record<string, unknown> }[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (modelId, input) => {
        calls.push({ modelId, input })
        return { model_glb: { url: 'https://from-photo.glb' } }
      },
    })
    await expect(generateFromImage({ imageUrl: 'https://photo' })).resolves.toBe(
      'https://from-photo.glb',
    )
    expect(calls[0]?.modelId).toBe(MESHY_V7_IMAGE_TO_3D)
    expect(calls[0]?.input).toMatchObject({
      image_url: 'https://photo',
      should_texture: false,
      enable_pbr: false,
      should_remesh: true,
      target_polycount: MESHY_TARGET_POLYCOUNT,
      topology: 'triangle',
    })
  })
})

describe('remeshGlb', () => {
  it('calls Tripo remesh without quad, bake, or a face_limit', async () => {
    const calls: { modelId: string; input: Record<string, unknown> }[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (modelId, input) => {
        calls.push({ modelId, input })
        return { model_mesh: { url: 'https://retopo.glb' } }
      },
    })
    await expect(remeshGlb({ meshUrl: 'https://source.glb' })).resolves.toBe('https://retopo.glb')
    expect(calls[0]?.modelId).toBe(TRIPO_REMESH)
    expect(calls[0]?.input).toEqual({ mesh_url: 'https://source.glb', quad: false, bake: false })
    expect(calls[0]?.input).not.toHaveProperty('face_limit')
  })
})
