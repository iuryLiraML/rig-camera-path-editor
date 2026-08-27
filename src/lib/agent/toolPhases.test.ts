import { describe, expect, it } from 'vitest'
import { toolsForPhase } from './toolPhases'
import { TOOL_DEFS } from './tools'

describe('Director tools stay on the existing SAM lane', () => {
  it('does not add generate_from_text or remesh_object', () => {
    const objectTools = toolsForPhase(TOOL_DEFS, 'object').map((tool) => tool.name)
    const cameraTools = toolsForPhase(TOOL_DEFS, 'camera').map((tool) => tool.name)
    expect(objectTools).toContain('generate_prop')
    expect(objectTools).toContain('set_scene_environment')
    expect(objectTools).toContain('block_scene_from_image')
    expect(objectTools).not.toContain('generate_from_text')
    expect(objectTools).not.toContain('remesh_object')
    expect(cameraTools).not.toContain('set_scene_environment')
    expect(cameraTools).not.toContain('block_scene_from_image')
    expect(cameraTools).not.toContain('generate_from_text')
    expect(cameraTools).not.toContain('remesh_object')
  })
})
