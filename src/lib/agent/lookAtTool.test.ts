import { describe, expect, it } from 'vitest'
import { executeTool } from './tools'
import { useRigStore } from '../../state/useRigStore'

describe('set_look_at offset', () => {
  it('refuses offset without a tracked object', async () => {
    useRigStore.setState({ targetObjectId: null, lookOffset: [0, 0, 0] })
    const result = await executeTool('set_look_at', { mode: 'target', offset: [0, 1, 0] })
    expect(result).toMatch(/tracked object/)
  })
})
