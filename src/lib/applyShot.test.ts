import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCameraOptionsStore } from '../state/useCameraOptionsStore'
import { useEditorStore } from '../state/useEditorStore'
import { useProjectStore, type Shot } from '../state/useProjectStore'
import { useRigStore } from '../state/useRigStore'
import { applyShot } from './projects'
import { makeEmptyRigSnapshot } from '../state/useCameraOptionsStore'

function fakeShot(): Shot {
  return {
    id: 'shot-review',
    name: 'Review take',
    order: 0,
    duration: 4,
    thumbnail: null,
    format: { aspect: '9:16', res: 720, custom: [1080, 1920] },
    rig: { ...makeEmptyRigSnapshot(), fov: 28, duration: 4, loop: false },
  }
}

beforeEach(() => {
  useEditorStore.setState({
    activeShotId: null,
    exportAspect: '16:9',
    exportRes: 1080,
    customSize: [1920, 1080],
  })
})

afterEach(() => {
  useEditorStore.setState({ activeShotId: null, exportAspect: '16:9', exportRes: 1080 })
  useProjectStore.setState({ shots: [] })
})

describe('applyShot', () => {
  it('restores the take without creating a camera option', () => {
    const created = vi.spyOn(useCameraOptionsStore.getState(), 'createOption')
    const before = useCameraOptionsStore.getState().options.length
    applyShot(fakeShot())
    expect(created).not.toHaveBeenCalled()
    expect(useCameraOptionsStore.getState().options.length).toBe(before)
    expect(useEditorStore.getState().activeShotId).toBe('shot-review')
    expect(useEditorStore.getState().exportAspect).toBe('9:16')
    expect(useEditorStore.getState().exportRes).toBe(720)
    expect(useRigStore.getState().fov).toBe(28)
    created.mockRestore()
  })
})
