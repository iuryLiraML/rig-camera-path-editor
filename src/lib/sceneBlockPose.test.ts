import { describe, expect, it } from 'vitest'
import {
  SAM_METRES_TO_RIG,
  isBlockSceneRequest,
  layoutBlockTransforms,
  parseSamPose,
  samPointToRig,
} from './sceneBlockPose'

describe('isBlockSceneRequest', () => {
  it('matches English and Portuguese scene-block phrases', () => {
    expect(isBlockSceneRequest('Block this scene')).toBe(true)
    expect(isBlockSceneRequest('please block this shot from the photo')).toBe(true)
    expect(isBlockSceneRequest('Quero blocar essa cena')).toBe(true)
    expect(isBlockSceneRequest('lift the people')).toBe(false)
    expect(isBlockSceneRequest('set the environment')).toBe(false)
  })
})

describe('parseSamPose', () => {
  it('reads translation arrays and radian euler', () => {
    const pose = parseSamPose({
      translation: [0.5, 0.2, 1],
      rotation: [0, Math.PI / 2, 0],
    })
    expect(pose.translation).toEqual([0.5, 0.2, 1])
    expect(pose.rotationDeg[1]).toBeCloseTo(90)
  })
})

describe('layoutBlockTransforms', () => {
  it('maps OpenCV-style points into Rig units and lifts the group to y=0', () => {
    expect(samPointToRig([1, 2, 3])).toEqual([1, -2, -3])
    const [person, chair] = layoutBlockTransforms([
      { translation: [0, 0.85, 0], rotationDeg: [0, 0, 0] },
      { translation: [1, 0.4, 0], rotationDeg: [0, 45, 0] },
    ])
    expect(person.position[0]).toBeCloseTo(0)
    expect(chair.position[0]).toBeCloseTo(1 * SAM_METRES_TO_RIG)
    expect(person.position[1]).toBeGreaterThanOrEqual(0)
    expect(chair.position[1]).toBeGreaterThanOrEqual(0)
    expect(chair.rotation[1]).toBeCloseTo(-45)
    expect(person.scale).toEqual([1, 1, 1])
  })
})
