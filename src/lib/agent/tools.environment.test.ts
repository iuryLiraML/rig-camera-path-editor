import { afterEach, describe, expect, it } from 'vitest'
import { setLiftAttachment } from '../fal/attachment'
import { executeTool } from './tools'

afterEach(() => {
  setLiftAttachment(null)
})

describe('set_scene_environment', () => {
  it('asks for a photo when none is attached', async () => {
    await expect(executeTool('set_scene_environment', {})).resolves.toMatch(/Attach a photo/)
  })

  it('rejects a video attachment', async () => {
    setLiftAttachment(new File([new Uint8Array([1])], 'room.mp4', { type: 'video/mp4' }))
    await expect(executeTool('set_scene_environment', {})).resolves.toMatch(/still/)
  })
})

describe('block_scene_from_image', () => {
  it('asks for a photo when none is attached', async () => {
    await expect(executeTool('block_scene_from_image', {})).resolves.toMatch(/Attach a photo/)
  })
})
