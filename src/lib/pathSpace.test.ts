import { describe, expect, it } from 'vitest'
import {
  bakeAnchorsToSpace,
  localPointToWorld,
  worldPointToLocal,
} from './pathSpace'
import type { PathAnchor } from '../state/usePathStore'
import type { Transform } from '../state/useSceneStore'

const parent: Transform = {
  position: [10, 2, -4],
  rotation: [0, 90, 0],
  scale: [1, 1, 1],
}

describe('pathSpace', () => {
  it('maps a local offset through a translated, yawed parent', () => {
    const world = localPointToWorld([0, 1, 2], parent)
    const back = worldPointToLocal(world, parent)
    expect(back[0]).toBeCloseTo(0, 5)
    expect(back[1]).toBeCloseTo(1, 5)
    expect(back[2]).toBeCloseTo(2, 5)
  })

  it('bakes anchors world↔local as inverses', () => {
    const anchors: PathAnchor[] = [
      {
        id: 'a',
        position: [3, 1, 5],
        handleIn: [0, 0, -1],
        handleOut: [0, 0, 1],
        mirrored: true,
        manual: true,
      },
    ]
    const local = bakeAnchorsToSpace(anchors, parent, 'worldToLocal')
    const world = bakeAnchorsToSpace(local, parent, 'localToWorld')
    expect(world[0].position[0]).toBeCloseTo(3, 5)
    expect(world[0].position[1]).toBeCloseTo(1, 5)
    expect(world[0].position[2]).toBeCloseTo(5, 5)
    expect(world[0].handleOut[2]).toBeCloseTo(1, 5)
  })
})
