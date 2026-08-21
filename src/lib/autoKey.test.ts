import { beforeEach, describe, expect, it } from 'vitest'
import { autoKeyObjectChannels, evaluatedStaticPose, writeObjectTransform, writeStaticPose } from './autoKey'
import { useRigStore } from '../state/useRigStore'
import { useSceneStore, identityTransform } from '../state/useSceneStore'

describe('auto-key', () => {
  beforeEach(() => {
    useSceneStore.setState({ objects: [], pendingLifts: [] })
    useRigStore.setState({
      t: 0.5,
      staticPose: { position: [4, 2, 6], rotation: [0, 0, 0] },
      staticPosKeys: [],
      staticRotKeys: [],
    })
  })

  it('writes a position key when that channel already has a track', () => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    useSceneStore.getState().addObjectKey(id, 0, 'position')
    writeObjectTransform(
      id,
      { ...identityTransform, position: [3, 0, 0] },
      ['position'],
    )
    const keys = useSceneStore.getState().objects[0].keys.filter((k) => k.channel === 'position')
    expect(keys).toHaveLength(2)
    expect(keys.some((k) => Math.abs(k.time - 0.5) < 0.02)).toBe(true)
  })

  it('does not key when the channel has no track yet', () => {
    useSceneStore.getState().addPrimitive('box')
    const id = useSceneStore.getState().objects[0].id
    autoKeyObjectChannels(id, ['position'])
    expect(useSceneStore.getState().objects[0].keys).toHaveLength(0)
  })

  it('keys Free-camera position only after that channel is animated', () => {
    writeStaticPose({ position: [1, 2, 3] })
    expect(useRigStore.getState().staticPosKeys).toHaveLength(0)
    expect(useRigStore.getState().staticPose.position).toEqual([1, 2, 3])

    useRigStore.getState().upsertStaticPosKey(0, [1, 2, 3])
    writeStaticPose({ position: [5, 2, 3] })
    expect(useRigStore.getState().staticPosKeys.length).toBeGreaterThanOrEqual(2)
    expect(useRigStore.getState().staticPose.position).toEqual([5, 2, 3])
  })

  it('reads the Free-camera pose at t, not the rest pose', () => {
    useRigStore.setState({
      t: 1,
      ease: 'linear',
      staticPose: { position: [0, 0, 0], rotation: [0, 0, 0] },
      staticPosKeys: [
        { id: 'a', time: 0, value: [0, 0, 0] },
        { id: 'b', time: 1, value: [10, 0, 0] },
      ],
      staticRotKeys: [],
    })
    expect(evaluatedStaticPose().position[0]).toBeCloseTo(10)
  })
})
