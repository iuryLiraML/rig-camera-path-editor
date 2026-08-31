import { describe, expect, it } from 'vitest'
import {
  SAM_METRES_TO_RIG,
  isBlockSceneRequest,
  layoutBlockTransforms,
  parseSamPose,
  readFocalLength,
  samEulerDegToRig,
  samPointToRig,
} from './sceneBlockPose'

describe('isBlockSceneRequest', () => {
  it('maps English and Portuguese scene-block phrases', () => {
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
    expect(pose.scale).toEqual([1, 1, 1])
  })

  it('reads nested 3d-objects TRS, quaternions, matrices, and Align scale_factor', () => {
    const object = parseSamPose({
      translation: [[0.5, 0.2, 1]],
      rotation: [[0, Math.SQRT1_2, 0, Math.SQRT1_2]],
      scale: [[0.4, 0.4, 0.4]],
    })
    expect(object.translation).toEqual([0.5, 0.2, 1])
    expect(object.rotationDeg[1]).toBeCloseTo(90)
    expect(object.scale).toEqual([0.4, 0.4, 0.4])

    const fromMatrix = parseSamPose({
      translation: [0, 0, 0],
      rotation: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    })
    expect(fromMatrix.rotationDeg[0]).toBeCloseTo(0)
    expect(fromMatrix.rotationDeg[1]).toBeCloseTo(0)
    expect(fromMatrix.rotationDeg[2]).toBeCloseTo(0)

    const fromFlat = parseSamPose({
      translation: [0, 0, 0],
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    })
    expect(fromFlat.rotationDeg[0]).toBeCloseTo(0)

    const aligned = parseSamPose({
      person_id: 0,
      scale_factor: 0.5,
      translation: [0.1, 0.2, 0.3],
      focal_length: 1100,
    })
    expect(aligned.translation).toEqual([0.1, 0.2, 0.3])
    expect(aligned.scale).toEqual([0.5, 0.5, 0.5])
    expect(readFocalLength({ people: [{ focal_length: 1200 }] })).toBe(1200)
  })
})

describe('layoutBlockTransforms', () => {
  it('maps Z-up SAM layout into Rig Y-up without tipping a standing pose', () => {
    expect(samPointToRig([1, 2, 3])).toEqual([1, 3, -2])
    const identity = samEulerDegToRig([0, 0, 0])
    expect(identity[0]).toBeCloseTo(0)
    expect(identity[1]).toBeCloseTo(0)
    expect(identity[2]).toBeCloseTo(0)

    const [person, chair] = layoutBlockTransforms([
      { translation: [0, 0, 0.85], rotationDeg: [0, 0, 0] },
      { translation: [1, 0, 0.4], rotationDeg: [0, 0, 45] },
    ])
    expect(person.position[0]).toBeCloseTo(0)
    expect(person.position[1]).toBeCloseTo(0.85 * SAM_METRES_TO_RIG)
    expect(chair.position[0]).toBeCloseTo(1 * SAM_METRES_TO_RIG)
    expect(person.position[1]).toBeGreaterThanOrEqual(0)
    expect(chair.position[1]).toBeGreaterThanOrEqual(0)
    expect(person.rotation[0]).toBeCloseTo(0)
    expect(person.rotation[2]).toBeCloseTo(0)
    expect(chair.rotation[1]).toBeCloseTo(45)
    expect(person.scale[0]).toBeCloseTo(SAM_METRES_TO_RIG)
  })
})
