import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CAMERA_NOISE } from '../lib/cameraNoise'
import { applyRigSnapshot, getRigSnapshot, useRigStore } from './useRigStore'
import { makeEmptyRigSnapshot, useCameraOptionsStore } from './useCameraOptionsStore'

afterEach(() => {
  applyRigSnapshot(makeEmptyRigSnapshot())
  useCameraOptionsStore.setState({
    options: [{ id: 'camera-default', name: 'Camera 1', rig: makeEmptyRigSnapshot() }],
    activeOptionId: 'camera-default',
  })
})

function fxSnapshot() {
  return {
    ...makeEmptyRigSnapshot(),
    cameraNoise: {
      ...DEFAULT_CAMERA_NOISE,
      enabled: true,
      style: 'handheld' as const,
      intensity: 0.7,
    },
    intensityKeys: [{ id: 'intensity-0', time: 0, value: 0.2 }, { id: 'intensity-1', time: 1, value: 1 }],
    ampPosKeys: [{ id: 'ampPos-0', time: 0.5, value: 0.04 }],
  }
}

describe('camera FX reload', () => {
  it('applyRigSnapshot restores enabled noise and its keys', () => {
    applyRigSnapshot(fxSnapshot())
    const rig = useRigStore.getState()
    expect(rig.cameraNoise.enabled).toBe(true)
    expect(rig.cameraNoise.style).toBe('handheld')
    expect(rig.cameraNoise.intensity).toBeCloseTo(0.7)
    expect(rig.intensityKeys).toHaveLength(2)
    expect(rig.ampPosKeys).toHaveLength(1)
  })

  it('loadOptions hydrates the live rig from the saved camera option, not defaults', () => {
    useRigStore.setState({ cameraNoise: { ...DEFAULT_CAMERA_NOISE }, intensityKeys: [], ampPosKeys: [] })
    useCameraOptionsStore.getState().loadOptions(
      [{ id: 'c1', name: 'Handheld', rig: fxSnapshot() }],
      'c1',
      makeEmptyRigSnapshot(),
    )
    const rig = useRigStore.getState()
    expect(rig.cameraNoise.enabled).toBe(true)
    expect(rig.intensityKeys.map((k) => k.value)).toEqual([0.2, 1])
  })

  it('getRigSnapshot round-trips the FX so the next project save keeps them', () => {
    applyRigSnapshot(fxSnapshot())
    const saved = getRigSnapshot()
    applyRigSnapshot(makeEmptyRigSnapshot())
    expect(useRigStore.getState().cameraNoise.enabled).toBe(false)

    applyRigSnapshot(saved)
    expect(useRigStore.getState().cameraNoise.enabled).toBe(true)
    expect(useRigStore.getState().intensityKeys).toHaveLength(2)
  })
})
