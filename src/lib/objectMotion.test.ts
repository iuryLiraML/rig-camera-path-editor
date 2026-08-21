import { describe, expect, it } from 'vitest'
import { evalObjectWorldPosition, evalObjectWorldTransform } from './objectMotion'
import { identityTransform, type FollowConfig } from '../state/useSceneStore'
import type { PathAnchor } from '../state/usePathStore'

function anchors(a: [number, number, number], b: [number, number, number]): PathAnchor[] {
  return [
    { id: 'a', position: a, handleIn: [0, 0, 0], handleOut: [0, 0, 0], mirrored: true, manual: false },
    { id: 'b', position: b, handleIn: [0, 0, 0], handleOut: [0, 0, 0], mirrored: true, manual: false },
  ]
}

describe('evalObjectWorldPosition', () => {
  it('uses the static pose when the object has no animation', () => {
    expect(
      evalObjectWorldPosition(
        0.5,
        { transform: { ...identityTransform, position: [1, 2, 3] }, keys: [] },
        null,
        'linear',
      ),
    ).toEqual([1, 2, 3])
  })

  it('interpolates pose keys', () => {
    const pos = evalObjectWorldPosition(
      0.5,
      {
        transform: identityTransform,
        keys: [
          { id: 'k0', time: 0, transform: { ...identityTransform, position: [0, 0, 0] } },
          { id: 'k1', time: 1, transform: { ...identityTransform, position: [4, 0, 0] } },
        ],
      },
      null,
      'linear',
    )
    expect(pos[0]).toBeCloseTo(2, 5)
    expect(pos[1]).toBeCloseTo(0, 5)
  })

  it('samples a follow path, including height', () => {
    const follow: FollowConfig = {
      pathId: 'p',
      align: false,
      offset: 0,
      height: 1,
      bank: 0,
      loops: 1,
    }
    const path = { anchors: anchors([0, 0, 0], [10, 0, 0]), closed: false, rounding: 0 }
    const start = evalObjectWorldPosition(0, { transform: identityTransform, keys: [], follow }, path, 'linear')
    const end = evalObjectWorldPosition(1, { transform: identityTransform, keys: [], follow }, path, 'linear')
    expect(start[0]).toBeCloseTo(0, 4)
    expect(start[1]).toBeCloseTo(1, 4)
    expect(end[0]).toBeCloseTo(10, 4)
    expect(end[1]).toBeCloseTo(1, 4)
  })

  it('interpolates rotation on pose keys', () => {
    const pose = evalObjectWorldTransform(
      0.5,
      {
        transform: identityTransform,
        keys: [
          { id: 'k0', time: 0, transform: { ...identityTransform, rotation: [0, 0, 0] } },
          { id: 'k1', time: 1, transform: { ...identityTransform, rotation: [0, 90, 0] } },
        ],
      },
      null,
      'linear',
    )
    expect(pose.rotation[1]).toBeCloseTo(45, 4)
  })

  it('mixes channel keys so position moves while rotation holds', () => {
    const pose = evalObjectWorldTransform(
      0.5,
      {
        transform: { ...identityTransform, rotation: [0, 15, 0] },
        keys: [
          {
            id: 'p0',
            time: 0,
            channel: 'position',
            transform: { ...identityTransform, position: [0, 0, 0] },
          },
          {
            id: 'p1',
            time: 1,
            channel: 'position',
            transform: { ...identityTransform, position: [6, 0, 0] },
          },
        ],
      },
      null,
      'linear',
    )
    expect(pose.position[0]).toBeCloseTo(3, 5)
    expect(pose.rotation[1]).toBeCloseTo(15, 5)
    expect(pose.scale).toEqual([1, 1, 1])
  })
})
