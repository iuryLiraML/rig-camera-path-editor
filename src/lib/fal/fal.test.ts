import { afterEach, describe, expect, it } from 'vitest'
import { consumeLiftAttachment, getLiftAttachment, setLiftAttachment } from './attachment'
import { configureFal, falErrorMessage, resetFalForTests, setFalTransportForTests } from './client'
import { falSplatFile, requireModelGlb } from './files'
import { generateFromImage, generateFromText, stillForMeshy } from './generate3d'
import { liftPerson, liftPersonDetailed, liftProp, liftPropDetailed } from './lift'
import {
  GENERATE_FACE_LIMIT,
  MESHY_TARGET_POLYCOUNT,
  MESHY_V7_IMAGE_TO_3D,
  MESHY_MULTI_ANIMATION,
  SAM_3D_BODY,
  SAM_3D_OBJECTS,
  SAM_3D_ALIGN,
  SAM_IMAGE_MODELS,
  TRIPO_H31_TEXT_TO_3D,
  TRIPO_REMESH,
  TRIPO_SPLAT,
  TRIPO_SPLAT_GAUSSIANS,
} from './models'
import { generateTripoSplat } from './tripoSplat'
import { makeFixtureSplatPly } from '../environment'
import { alignBodyToImage } from './samAlign'
import { animatePersonWithMeshy, MESHY_CURATED_CLIPS } from './meshyAnimation'
import { liftAttachedStill, runMaskThenLift } from './pipeline'
import { remeshFaceLimit, remeshGlb, TRIPO_REMESH_FACE_MAX, TRIPO_REMESH_FACE_MIN } from './remesh'
import { segmentImage, segmentImageWithFallback } from './segment'

function fakeGlbBytes(): Uint8Array {
  const bytes = new Uint8Array(12)
  new DataView(bytes.buffer).setUint32(0, 0x46546c67, true)
  return bytes
}

afterEach(() => {
  resetFalForTests()
  consumeLiftAttachment()
})

describe('falErrorMessage', () => {
  it('reads Fal validation detail from a non-Error payload', () => {
    expect(
      falErrorMessage({
        status: 422,
        body: { detail: [{ loc: ['body', 'num_gaussians'], msg: 'Input should be less than or equal to 262144' }] },
      }),
    ).toMatch(/262144/)
    expect(falErrorMessage({ body: { detail: 'NSFW content detected' } })).toBe('NSFW content detected')
    expect(falErrorMessage({}, 'Environment generate failed')).toBe('Environment generate failed')
  })
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

  it('lets scene block raise the mask cap', async () => {
    const calls: { input: Record<string, unknown> }[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (_modelId, input) => {
        calls.push({ input })
        return { masks: [{ url: 'https://cdn.example/mask.png' }] }
      },
    })
    await segmentImage({
      version: '3.1',
      imageUrl: 'https://photo',
      prompt: 'table',
      maxMasks: 32,
    })
    expect(calls[0]?.input.max_masks).toBe(32)
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
        export_meshes: false,
        include_3d_keypoints: false,
        include_mhr_params: false,
      },
    })
    expect(calls[1]).toEqual({
      modelId: SAM_3D_OBJECTS,
      input: {
        image_url: 'https://photo',
        mask_urls: ['https://mask'],
        prompt: 'helmet',
        export_textured_glb: true,
      },
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
      export_meshes: false,
      include_3d_keypoints: false,
      include_mhr_params: false,
    })
  })

  it('asks 3d-objects for a textured GLB from a noun without a 3.1 mask', async () => {
    const calls: Record<string, unknown>[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (_modelId, input) => {
        calls.push(input)
        return { model_glb: { url: 'https://cdn.example/chair.glb' } }
      },
    })
    await expect(liftProp({ imageUrl: 'https://photo', prompt: 'chair' })).resolves.toBe(
      'https://cdn.example/chair.glb',
    )
    expect(calls[0]).toEqual({
      image_url: 'https://photo',
      prompt: 'chair',
      export_textured_glb: true,
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

  it('does not treat the 3d-objects gaussian_splat as a clay GLB', async () => {
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async () => ({
        gaussian_splat: { url: 'https://cdn.example/object.ply', file_name: 'object.ply' },
        individual_splats: [{ url: 'https://cdn.example/object.ply' }],
      }),
    })
    await expect(
      liftPropDetailed({ imageUrl: 'https://photo', maskUrl: 'https://mask', prompt: 'chair' }),
    ).rejects.toThrow(/Gaussian splat/)
  })

  it('prefers an individual GLB when model_glb is a splat URL', async () => {
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async () => ({
        gaussian_splat: { url: 'https://cdn.example/scene.ply', file_name: 'scene.ply' },
        model_glb: { url: 'https://cdn.example/scene.ply', file_name: 'scene.ply' },
        individual_glbs: [{ url: 'https://cdn.example/chair.glb', file_name: 'chair.glb' }],
      }),
    })
    await expect(
      liftPropDetailed({ imageUrl: 'https://photo', maskUrl: 'https://mask', prompt: 'chair' }),
    ).resolves.toMatchObject({ glbUrl: 'https://cdn.example/chair.glb' })
  })
})

describe('align', () => {
  it('sends body mesh and mask without an object mesh', async () => {
    const calls: { modelId: string; input: Record<string, unknown> }[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (modelId, input) => {
        calls.push({ modelId, input })
        return { metadata: { translation: [0, 0, 0] }, model_glb: { url: 'https://cdn.example/aligned.glb' } }
      },
    })
    await expect(
      alignBodyToImage({
        imageUrl: 'https://photo',
        bodyMeshUrl: 'https://body.glb',
        bodyMaskUrl: 'https://mask',
      }),
    ).resolves.toMatchObject({ glbUrl: 'https://cdn.example/aligned.glb' })
    expect(calls[0]).toEqual({
      modelId: SAM_3D_ALIGN,
      input: {
        image_url: 'https://photo',
        body_mesh_url: 'https://body.glb',
        body_mask_url: 'https://mask',
      },
    })
  })

  it('sends the first object mesh so body lands in the objects frame', async () => {
    const calls: { modelId: string; input: Record<string, unknown> }[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (modelId, input) => {
        calls.push({ modelId, input })
        return { metadata: { scale_factor: 0.8, translation: [0, 0, 0] } }
      },
    })
    await alignBodyToImage({
      imageUrl: 'https://photo',
      bodyMeshUrl: 'https://body.glb',
      bodyMaskUrl: 'https://mask',
      objectMeshUrl: 'https://chair.glb',
      focalLength: 1200,
    })
    expect(calls[0]?.input).toMatchObject({
      object_mesh_url: 'https://chair.glb',
      focal_length: 1200,
    })
  })

  it('returns scene_glb when Fal includes the combined scene', async () => {
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async () => ({
        model_glb: { url: 'https://cdn.example/aligned.glb' },
        scene_glb: { url: 'https://cdn.example/scene.glb' },
      }),
    })
    await expect(
      alignBodyToImage({
        imageUrl: 'https://photo',
        bodyMeshUrl: 'https://body.glb',
        objectMeshUrl: 'https://chair.glb',
      }),
    ).resolves.toMatchObject({
      glbUrl: 'https://cdn.example/aligned.glb',
      sceneGlbUrl: 'https://cdn.example/scene.glb',
    })
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
        return new Response(fakeGlbBytes(), { status: 200 })
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
      expect(message).toContain('Added to Unplaced')
      expect(message).toContain('Do not pose_object')
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
        return new Response(fakeGlbBytes(), { status: 200 })
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

  it('rejects a Gaussian splat posing as a mesh', () => {
    expect(() =>
      requireModelGlb({ model_mesh: { url: 'https://a.ply', file_name: 'room.ply' } }, 'triposplat'),
    ).toThrow(/Gaussian splat/)
  })

  it('picks a splat file over a PNG placeholder on the same payload', () => {
    expect(
      falSplatFile({
        model_mesh: { url: 'https://cdn.example/z.png', file_name: 'z.png' },
        model_urls: { ply: { url: 'https://cdn.example/room.ply', file_name: 'room.ply' } },
      }),
    ).toEqual({ url: 'https://cdn.example/room.ply', file_name: 'room.ply' })
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

describe('stillForMeshy', () => {
  it('accepts JPEG and PNG and refuses WebP', () => {
    expect(stillForMeshy(new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })).name).toBe('a.jpg')
    expect(stillForMeshy(new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })).name).toBe('a.png')
    expect(() => stillForMeshy(new File([new Uint8Array([1])], 'a.webp', { type: 'image/webp' }))).toThrow(
      /JPEG or PNG/,
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
      should_remesh: true,
      target_polycount: MESHY_TARGET_POLYCOUNT,
      topology: 'triangle',
    })
    // Meshy 422s: enable_pbr is only valid when should_texture is true.
    expect(calls[0]?.input).not.toHaveProperty('enable_pbr')
  })
})

describe('remeshFaceLimit', () => {
  it('keeps half the source faces and clamps to the Fal remesh range', () => {
    expect(remeshFaceLimit(8_000)).toBe(4_000)
    expect(remeshFaceLimit(400_000)).toBe(TRIPO_REMESH_FACE_MAX)
    expect(remeshFaceLimit(100)).toBe(TRIPO_REMESH_FACE_MIN)
  })
})

describe('remeshGlb', () => {
  it('prefers the explicit GLB variant over a non-GLB model_mesh', async () => {
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async () => ({
        model_mesh: {
          url: 'https://cdn.example/remesh-preview.png',
          file_name: 'remesh-preview.png',
        },
        model_urls: {
          glb: {
            url: 'https://cdn.example/remeshed-boat.glb',
            file_name: 'remeshed-boat.glb',
          },
        },
      }),
    })

    await expect(remeshGlb({ meshUrl: 'https://source.glb' })).resolves.toBe(
      'https://cdn.example/remeshed-boat.glb',
    )
  })

  it('calls Tripo remesh with triangles, no quad/bake, and a face_limit', async () => {
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
    expect(calls[0]?.input).toEqual({
      mesh_url: 'https://source.glb',
      quad: false,
      bake: false,
      face_limit: TRIPO_REMESH_FACE_MAX,
    })
    await remeshGlb({ meshUrl: 'https://source.glb', sourceTriangles: 8_000 })
    expect(calls[1]?.input.face_limit).toBe(4_000)
  })

  it('asks Fal for runner logs so remesh can show real progress', async () => {
    const optsSeen: Array<{ logs?: boolean } | undefined> = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (_modelId, _input, opts) => {
        optsSeen.push(opts)
        return { model_mesh: { url: 'https://retopo.glb' } }
      },
    })
    await remeshGlb({ meshUrl: 'https://source.glb' })
    expect(optsSeen[0]?.logs).toBe(true)
  })
})

describe('generateTripoSplat', () => {
  it('requests ply and downloads binary splat bytes', async () => {
    const calls: { modelId: string; input: Record<string, unknown> }[] = []
    const optsSeen: Array<{ logs?: boolean } | undefined> = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (modelId, input, opts) => {
        calls.push({ modelId, input })
        optsSeen.push(opts)
        return { model_mesh: { url: 'https://cdn.example/room.ply', file_name: 'room.ply' } }
      },
    })
    const ply = makeFixtureSplatPly()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(ply, { status: 200 })) as typeof fetch
    try {
      const result = await generateTripoSplat({ imageUrl: 'https://photo' })
      expect(calls[0]?.modelId).toBe(TRIPO_SPLAT)
      expect(calls[0]?.input.output_format).toBe('ply')
      expect(calls[0]?.input.num_gaussians).toBe(TRIPO_SPLAT_GAUSSIANS)
      expect(calls[0]?.input.image_url).toBe('https://photo')
      expect(optsSeen[0]?.logs).toBe(true)
      expect(result.fileName).toBe('room.ply')
      expect(result.format).toBe('ply')
      expect(result.buffer.byteLength).toBe(ply.byteLength)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects ASCII PLY before the viewport loader hangs', async () => {
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async () => ({
        model_mesh: { url: 'https://cdn.example/room.ply', file_name: 'room.ply' },
      }),
    })
    const ascii = new TextEncoder().encode(
      'ply\nformat ascii 1.0\nelement vertex 0\nend_header\n',
    )
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(ascii, { status: 200 })) as typeof fetch
    try {
      await expect(generateTripoSplat({ imageUrl: 'https://photo' })).rejects.toThrow(/ASCII PLY/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('animatePersonWithMeshy', () => {
  it('sends curated Meshy action ids and downloads the rigged GLB', async () => {
    const calls: { modelId: string; input: Record<string, unknown> }[] = []
    configureFal('key-test')
    setFalTransportForTests({
      subscribe: async (modelId, input) => {
        calls.push({ modelId, input })
        return {
          rigged_character_glb: { url: 'https://cdn.example/rigged.glb' },
          animations: [{ action_id: 0, animation_glb: { url: 'https://cdn.example/idle.glb' } }],
        }
      },
    })
    const originalFetch = globalThis.fetch
    const fetched: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetched.push(String(input))
      return new Response(fakeGlbBytes(), { status: 200 })
    }) as typeof fetch
    try {
      const result = await animatePersonWithMeshy({ modelUrl: 'https://mesh.glb' })
      expect(calls[0]?.modelId).toBe(MESHY_MULTI_ANIMATION)
      expect(calls[0]?.input.model_url).toBe('https://mesh.glb')
      expect(calls[0]?.input.animation_action_ids).toEqual(MESHY_CURATED_CLIPS.map((clip) => clip.id))
      expect(new Uint8Array(result.buffer).subarray(0, 4)).toEqual(fakeGlbBytes().subarray(0, 4))
      expect(fetched).toContain('https://cdn.example/rigged.glb')
      expect(fetched).toContain('https://cdn.example/idle.glb')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
